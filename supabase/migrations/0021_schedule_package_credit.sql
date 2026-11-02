-- Link individually scheduled appointments to the purchase that funded them.
alter table public.bookings
  add column if not exists purchase_id uuid references public.package_purchases(id);

create index if not exists bookings_purchase_id_idx
  on public.bookings (purchase_id, session_index);

-- Atomically check a verified purchase's remaining balance and reserve one
-- available slot. A conflict or expired/exhausted purchase creates no booking,
-- token, or credit-ledger event.
create or replace function public.schedule_package_credit(
  p_purchase_id uuid,
  p_starts_at timestamptz,
  p_current_token_hash text,
  p_token_hash text,
  p_token_expires_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_purchase public.package_purchases%rowtype;
  v_available integer;
  v_session_index integer;
  v_local_start timestamp;
  v_weekday integer;
  v_minute integer;
  v_occupied_min integer;
  v_rule public.availability_rules%rowtype;
  v_booking public.bookings%rowtype;
  v_end timestamptz;
begin
  if p_current_token_hash is null or length(p_current_token_hash) <> 64 or
     p_token_hash is null or length(p_token_hash) <> 64 or
     p_token_expires_at is null or p_token_expires_at <= now() or
     p_starts_at is null or p_starts_at < now() + interval '120 minutes' or
     p_starts_at > now() + interval '185 days' then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select * into v_purchase
  from public.package_purchases
  where id = p_purchase_id
  for update;
  if not found or v_purchase.payment_status <> 'paid' or
     v_purchase.valid_until is null or v_purchase.valid_until <= now() or
     p_starts_at >= v_purchase.valid_until then
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  if not exists (
    select 1 from public.package_purchase_tokens
    where token_hash = p_current_token_hash and purchase_id = p_purchase_id and expires_at > now()
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select coalesce(sum(quantity_delta), 0)::integer into v_available
  from public.package_credit_events
  where purchase_id = p_purchase_id;
  if v_available < 1 then
    return jsonb_build_object('ok', false, 'error', 'not_modifiable');
  end if;

  perform public.lock_booking_day(p_starts_at);
  v_local_start := p_starts_at at time zone 'America/Vancouver';
  v_weekday := extract(dow from v_local_start)::integer;
  v_minute := extract(hour from v_local_start)::integer * 60 + extract(minute from v_local_start)::integer;
  v_occupied_min := public.booking_occupied_duration_min(v_purchase.duration_min);
  v_end := p_starts_at + make_interval(mins => v_purchase.duration_min);
  select * into v_rule from public.availability_rules where weekday = v_weekday;
  if not found or v_minute < v_rule.start_min or v_minute + v_occupied_min > v_rule.end_min or
     v_minute % 30 <> 0 or extract(second from v_local_start) <> 0 or
     exists (select 1 from public.blackout_dates where date = v_local_start::date) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if public.booking_overlaps(p_starts_at, v_end) then
    return jsonb_build_object('ok', false, 'error', 'conflict');
  end if;

  select coalesce(max(session_index), 0) + 1 into v_session_index
  from public.bookings where purchase_id = p_purchase_id;
  if v_session_index > v_purchase.credits_purchased then
    return jsonb_build_object('ok', false, 'error', 'not_modifiable');
  end if;

  insert into public.bookings (
    package_id, purchase_id, session_index, session_count, package_price_cad,
    package_window_start, reference, lesson_id, lesson_name, duration_min,
    price_cad, starts_at, ends_at, student_name, email, phone, notes, status,
    payment_status, stripe_payment_intent_id, stripe_invoice_id, stripe_invoice_url,
    stripe_currency
  ) values (
    p_purchase_id, p_purchase_id, v_session_index, v_purchase.credits_purchased,
    v_purchase.amount_cad,
    (p_starts_at at time zone 'America/Vancouver')::date,
    public.new_reference(), v_purchase.lesson_id, v_purchase.lesson_name,
    v_purchase.duration_min,
    (round(v_purchase.amount_cad * 100)::bigint / v_purchase.credits_purchased +
      case when v_session_index <= mod(round(v_purchase.amount_cad * 100)::bigint, v_purchase.credits_purchased) then 1 else 0 end)::numeric / 100,
    p_starts_at, v_end, v_purchase.student_name, v_purchase.email,
    v_purchase.phone, v_purchase.notes, 'confirmed', 'paid',
    v_purchase.stripe_payment_intent_id, v_purchase.stripe_invoice_id,
    v_purchase.stripe_invoice_url, v_purchase.currency
  ) returning * into v_booking;

  insert into public.booking_tokens(token_hash, booking_id, expires_at)
  values (p_token_hash, v_booking.id, p_token_expires_at);
  insert into public.package_credit_events(purchase_id, booking_id, event_type, quantity_delta, source_key, note)
  values (p_purchase_id, v_booking.id, 'redeem', -1,
    'scheduled-credit:' || v_booking.id::text,
    'One credit redeemed for a scheduled session.');

  delete from public.package_purchase_tokens where purchase_id = p_purchase_id;
  insert into public.package_purchase_tokens(token_hash, purchase_id, expires_at)
  values (p_token_hash, p_purchase_id, p_token_expires_at);

  return jsonb_build_object('ok', true, 'record', to_jsonb(v_booking));
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'conflict');
end;
$$;

revoke all on function public.schedule_package_credit(uuid, timestamptz, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.schedule_package_credit(uuid, timestamptz, text, text, timestamptz)
  to service_role;
