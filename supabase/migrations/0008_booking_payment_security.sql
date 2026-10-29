-- Give unpaid reservations a bounded hold and make pending slots expire.
alter table public.bookings
  add column if not exists stripe_checkout_expires_at timestamptz;

-- Existing unpaid pending bookings get no additional hold when this migration
-- is installed; new bookings start with a 30-minute hold in create_booking.
update public.bookings
set stripe_checkout_expires_at = least(created_at + interval '30 minutes', now())
where status = 'pending_payment' and payment_status = 'due'
  and stripe_checkout_expires_at is null;

create or replace function public.booking_overlaps(
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_exclude_booking_id uuid default null
) returns boolean
language sql stable set search_path = public, extensions
as $$
  select exists (
    select 1 from public.bookings b
    where b.status in ('confirmed', 'rescheduled')
      and (p_exclude_booking_id is null or b.id <> p_exclude_booking_id)
      and b.starts_at < p_ends_at and p_starts_at < b.ends_at
  ) or exists (
    select 1 from public.bookings b
    where b.status = 'pending_payment' and b.payment_status = 'due'
      and (b.stripe_checkout_expires_at is null or b.stripe_checkout_expires_at > now())
      and (p_exclude_booking_id is null or b.id <> p_exclude_booking_id)
      and b.starts_at < p_ends_at and p_starts_at < b.ends_at
  );
$$;

create or replace function public.create_booking(
  p_token_hash text, p_token_expires_at timestamptz, p_lesson_id text,
  p_lesson_name text, p_duration_min integer, p_price_cad numeric,
  p_starts_at timestamptz, p_ends_at timestamptz, p_student_name text,
  p_email text, p_phone text, p_notes text
) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_booking public.bookings;
begin
  if p_token_hash is null or length(p_token_hash) < 32 then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  perform public.lock_booking_day(p_starts_at);
  if public.booking_overlaps(p_starts_at, p_ends_at) then
    return jsonb_build_object('ok', false, 'error', 'conflict');
  end if;
  insert into public.bookings (
    reference, lesson_id, lesson_name, duration_min, price_cad, starts_at,
    ends_at, student_name, email, phone, notes, status
  ) values (
    public.new_reference(), p_lesson_id, p_lesson_name, p_duration_min,
    p_price_cad, p_starts_at, p_ends_at, p_student_name, p_email,
    p_phone, p_notes, 'pending_payment'
  ) returning * into v_booking;
  update public.bookings set stripe_checkout_expires_at = now() + interval '30 minutes'
    where id = v_booking.id returning * into v_booking;
  insert into public.booking_tokens(token_hash, booking_id, expires_at)
    values (p_token_hash, v_booking.id, p_token_expires_at);
  return jsonb_build_object('ok', true, 'record', to_jsonb(v_booking));
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'conflict');
end;
$$;

revoke execute on function public.create_booking(text, timestamptz, text, text, integer, numeric, timestamptz, timestamptz, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_booking(text, timestamptz, text, text, integer, numeric, timestamptz, timestamptz, text, text, text, text) to service_role;

create or replace function public.record_stripe_checkout_event(
  p_event_id text, p_event_type text, p_booking_id uuid, p_session_id text,
  p_payment_intent_id text default null, p_invoice_id text default null,
  p_invoice_url text default null, p_subtotal_cents bigint default null,
  p_tax_cents bigint default null, p_total_cents bigint default null,
  p_currency text default null
) returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
begin
  insert into public.stripe_webhook_events(event_id, event_type)
    values (p_event_id, p_event_type) on conflict (event_id) do nothing;
  if not found then return false; end if;
  if p_event_type = 'paid' then
    update public.bookings set payment_status = 'paid',
      status = case when status = 'pending_payment' then 'confirmed' else status end,
      stripe_checkout_session_id = p_session_id,
      stripe_payment_intent_id = p_payment_intent_id,
      stripe_invoice_id = p_invoice_id, stripe_invoice_url = p_invoice_url,
      stripe_subtotal_cad = p_subtotal_cents::numeric / 100,
      stripe_tax_cad = p_tax_cents::numeric / 100,
      stripe_total_cad = p_total_cents::numeric / 100,
      stripe_currency = lower(coalesce(p_currency, 'cad')),
      stripe_checkout_expires_at = null, updated_at = now()
    where id = p_booking_id and payment_status <> 'refunded';
  elsif p_event_type = 'expired' then
    update public.bookings set stripe_checkout_session_id = null,
      stripe_checkout_expires_at = case when status = 'pending_payment' then now() else null end,
      stripe_checkout_attempt = stripe_checkout_attempt + 1, updated_at = now()
    where id = p_booking_id and stripe_checkout_session_id = p_session_id
      and payment_status = 'due';
  else
    raise exception 'Unsupported Stripe checkout event kind: %', p_event_type;
  end if;
  return true;
end;
$$;

revoke execute on function public.record_stripe_checkout_event(text, text, uuid, text, text, text, text, bigint, bigint, bigint, text) from public, anon, authenticated;
grant execute on function public.record_stripe_checkout_event(text, text, uuid, text, text, text, text, bigint, bigint, bigint, text) to service_role;

-- Pin the existing SECURITY DEFINER RPCs as well as the two replaced above.
alter function public.get_booking_by_token(text) set search_path = public, extensions;
alter function public.reschedule_booking_by_token(text, timestamptz, timestamptz, text, timestamptz)
  set search_path = public, extensions;
alter function public.cancel_booking_by_token(text) set search_path = public, extensions;
alter function public.reschedule_student_booking_by_token(text, timestamptz, timestamptz, text, timestamptz)
  set search_path = public, extensions;
alter function public.consume_booking_otp_send_quota(text, timestamptz)
  set search_path = public, extensions;
