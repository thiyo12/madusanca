-- Reserve every lesson in an additional package before sending the customer
-- to Stripe. Paid webhooks confirm these rows and redeem the matching credits.
create or replace function public.create_scheduled_package_purchase_checkout(
  p_purchase_id uuid,
  p_reference text,
  p_lesson_id text,
  p_quantity integer,
  p_amount_cad numeric,
  p_starts_at jsonb,
  p_manage_token_hash text,
  p_session_id text,
  p_expires_at timestamptz,
  p_notes text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_anchor public.bookings%rowtype;
  v_lesson public.lessons%rowtype;
  v_purchase public.package_purchases%rowtype;
  v_start timestamptz;
  v_first timestamptz;
  v_last timestamptz;
  v_local_start timestamp;
  v_first_day date;
  v_last_day date;
  v_weekday integer;
  v_minute integer;
  v_start_min integer;
  v_end_min integer;
  v_rule public.availability_rules%rowtype;
  v_override public.availability_date_overrides%rowtype;
  v_count integer;
  v_index integer := 0;
  v_total_cents bigint;
  v_base_cents bigint;
  v_remainder bigint;
  v_booking_id uuid;
  v_root_booking_id uuid;
  v_now timestamptz := now();
begin
  if p_purchase_id is null or p_reference is null or p_reference !~ '^WDA-A-[A-Z0-9]{12}$' or
     p_lesson_id is null or p_quantity is null or p_quantity < 1 or
     p_manage_token_hash is null or p_manage_token_hash !~ '^[a-f0-9]{64}$' or
     p_session_id is null or length(p_session_id) < 8 or
     p_expires_at is null or p_expires_at <= v_now or p_expires_at > v_now + interval '32 minutes' or
     jsonb_typeof(p_starts_at) is distinct from 'array' or jsonb_array_length(p_starts_at) < 1 or jsonb_array_length(p_starts_at) > 20 then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select b.* into v_anchor
  from public.booking_tokens t
  join public.bookings b on b.id = t.booking_id
  where t.token_hash = p_manage_token_hash and t.expires_at > v_now
  for update of b;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

  if not exists (
    select 1 from public.bookings b
    where coalesce(b.package_id, b.id) = coalesce(v_anchor.package_id, v_anchor.id)
      and b.status in ('confirmed', 'rescheduled') and b.payment_status = 'paid'
      and b.starts_at > v_now + interval '48 hours'
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_modifiable');
  end if;

  select * into v_lesson from public.lessons where id = p_lesson_id and category = 'package';
  if not found or v_lesson.session_count * p_quantity > 20 or
     p_amount_cad is distinct from round(v_lesson.price_cad * p_quantity, 2) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  v_count := v_lesson.session_count * p_quantity;
  if jsonb_array_length(p_starts_at) <> v_count or exists (
    select 1 from jsonb_array_elements(p_starts_at) s(value)
    where jsonb_typeof(s.value) <> 'string'
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select min(value::timestamptz), max(value::timestamptz)
    into v_first, v_last from jsonb_array_elements_text(p_starts_at);
  if v_first is null or v_last is null or v_first < v_now + interval '120 minutes' or
     v_first > v_now + interval '6 months' then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  v_first_day := (v_first at time zone 'America/Vancouver')::date;
  v_last_day := (v_last at time zone 'America/Vancouver')::date;
  if v_last_day > (v_first_day + interval '6 months')::date then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(p_starts_at) s(value)
    group by value::timestamptz having count(*) > 1
  ) then
    return jsonb_build_object('ok', false, 'error', 'conflict');
  end if;
  if exists (
    select 1
    from jsonb_array_elements_text(p_starts_at) with ordinality a(value, ordinality)
    join jsonb_array_elements_text(p_starts_at) with ordinality b(value, ordinality) on a.ordinality < b.ordinality
    where a.value::timestamptz < b.value::timestamptz + make_interval(mins => public.booking_occupied_duration_min(v_lesson.duration_min))
      and b.value::timestamptz < a.value::timestamptz + make_interval(mins => public.booking_occupied_duration_min(v_lesson.duration_min))
  ) then
    return jsonb_build_object('ok', false, 'error', 'conflict');
  end if;

  -- Serialize all selected days before checking, then recheck availability in
  -- the same transaction that creates the pending appointments.
  for v_start in
    select value::timestamptz from jsonb_array_elements_text(p_starts_at) order by value::timestamptz
  loop
    perform public.lock_booking_day(v_start);
  end loop;

  for v_start in
    select value::timestamptz from jsonb_array_elements_text(p_starts_at) order by value::timestamptz
  loop
    if v_start < v_now + interval '120 minutes' or
       public.booking_overlaps(v_start, v_start + make_interval(mins => v_lesson.duration_min)) then
      return jsonb_build_object('ok', false, 'error', 'conflict');
    end if;
    v_local_start := v_start at time zone 'America/Vancouver';
    v_weekday := extract(dow from v_local_start)::integer;
    v_minute := extract(hour from v_local_start)::integer * 60 + extract(minute from v_local_start)::integer;
    select * into v_rule from public.availability_rules where weekday = v_weekday;
    if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    v_start_min := v_rule.start_min;
    v_end_min := v_rule.end_min;
    select * into v_override from public.availability_date_overrides where date = v_local_start::date;
    if found then
      v_start_min := v_override.start_min;
      v_end_min := v_override.end_min;
    end if;
    if v_minute < v_start_min or
       v_minute + public.booking_occupied_duration_min(v_lesson.duration_min) > v_end_min or
       mod(v_minute - v_start_min, public.booking_start_cadence_min(v_lesson.duration_min)) <> 0 or
       extract(second from v_local_start) <> 0 or
       exists (select 1 from public.blackout_dates where date = v_local_start::date) then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
  end loop;

  insert into public.package_purchases (
    id, reference, student_name, email, phone, notes, lesson_id, lesson_name,
    duration_min, credits_purchased, amount_cad, currency, payment_status,
    stripe_checkout_session_id, stripe_checkout_expires_at, source
  ) values (
    p_purchase_id, p_reference, v_anchor.student_name, lower(v_anchor.email), v_anchor.phone,
    coalesce(p_notes, ''), v_lesson.id, v_lesson.name, v_lesson.duration_min,
    v_count, p_amount_cad, 'cad', 'pending', p_session_id, p_expires_at, 'new'
  ) returning * into v_purchase;

  v_total_cents := round(p_amount_cad * 100)::bigint;
  v_base_cents := v_total_cents / v_count;
  v_remainder := mod(v_total_cents, v_count);
  for v_start in
    select value::timestamptz from jsonb_array_elements_text(p_starts_at) order by value::timestamptz
  loop
    v_index := v_index + 1;
    insert into public.bookings (
      package_id, purchase_id, session_index, session_count, package_price_cad,
      package_window_start, reference, lesson_id, lesson_name, duration_min,
      price_cad, starts_at, ends_at, student_name, email, phone, notes,
      status, payment_status, stripe_checkout_expires_at, stripe_currency
    ) values (
      p_purchase_id, p_purchase_id, v_index, v_count, p_amount_cad, v_first_day,
      public.new_reference(), v_lesson.id, v_lesson.name, v_lesson.duration_min,
      (v_base_cents + case when v_index <= v_remainder then 1 else 0 end)::numeric / 100,
      v_start, v_start + make_interval(mins => v_lesson.duration_min),
      v_anchor.student_name, lower(v_anchor.email), v_anchor.phone, coalesce(p_notes, ''),
      'pending_payment', 'due', p_expires_at, 'cad'
    ) returning id into v_booking_id;
    if v_root_booking_id is null then v_root_booking_id := v_booking_id; end if;
  end loop;

  -- Each booking row has a 10-minute pre-checkout cap. Attach the live Stripe
  -- session to one row and extend the rest to the matching Checkout expiry.
  update public.bookings set stripe_checkout_session_id = p_session_id,
    stripe_checkout_expires_at = p_expires_at, updated_at = v_now
  where id = v_root_booking_id;
  update public.bookings set stripe_checkout_expires_at = p_expires_at, updated_at = v_now
  where purchase_id = p_purchase_id and id <> v_root_booking_id;

  return jsonb_build_object('ok', true, 'record', to_jsonb(v_purchase));
exception
  when unique_violation then return jsonb_build_object('ok', false, 'error', 'conflict');
  when invalid_datetime_format or datetime_field_overflow then return jsonb_build_object('ok', false, 'error', 'not_found');
end;
$$;

revoke all on function public.create_scheduled_package_purchase_checkout(uuid, text, text, integer, numeric, jsonb, text, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.create_scheduled_package_purchase_checkout(uuid, text, text, integer, numeric, jsonb, text, text, timestamptz, text)
  to service_role;

create or replace function public.fulfill_package_purchase_payment(
  p_event_id text,
  p_purchase_id uuid,
  p_session_id text,
  p_payment_intent_id text,
  p_invoice_id text,
  p_invoice_url text,
  p_subtotal_cents bigint,
  p_tax_cents bigint,
  p_total_cents bigint,
  p_currency text,
  p_paid_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_purchase public.package_purchases%rowtype;
  v_paid_at timestamptz;
  v_valid_until timestamptz;
  v_scheduled_count integer;
  v_scheduled_ids uuid[] := '{}';
begin
  select * into v_purchase from public.package_purchases where id = p_purchase_id for update;
  if not found or v_purchase.source <> 'new' or
     v_purchase.stripe_checkout_session_id is distinct from p_session_id or
     v_purchase.payment_status not in ('pending', 'paid') or
     p_paid_at is null or p_paid_at > now() + interval '5 minutes' or
     lower(coalesce(p_currency, '')) <> 'cad' or
     p_subtotal_cents is distinct from round(v_purchase.amount_cad * 100)::bigint or
     p_tax_cents is null or p_tax_cents < 0 or p_total_cents is distinct from p_subtotal_cents + p_tax_cents then
    return false;
  end if;
  if v_purchase.payment_status = 'pending' then
    select count(*)::integer, coalesce(array_agg(id order by session_index), '{}')
      into v_scheduled_count, v_scheduled_ids
    from public.bookings where purchase_id = p_purchase_id;
    if v_scheduled_count not in (0, v_purchase.credits_purchased) then return false; end if;
    if v_scheduled_count > 0 and exists (
      select 1 from public.bookings where purchase_id = p_purchase_id
        and (status <> 'pending_payment' or payment_status <> 'due')
    ) then return false; end if;
  end if;

  insert into public.stripe_webhook_events (event_id, event_type)
  values (p_event_id, 'package_purchase_paid') on conflict (event_id) do nothing;
  if not found then return false; end if;

  v_paid_at := coalesce(v_purchase.purchased_at, p_paid_at);
  v_valid_until := coalesce(v_purchase.valid_until,
    (v_paid_at at time zone 'America/Vancouver' + interval '6 months') at time zone 'America/Vancouver');
  update public.package_purchases set payment_status = 'paid', purchased_at = v_paid_at,
    valid_until = v_valid_until, stripe_payment_intent_id = p_payment_intent_id,
    stripe_invoice_id = p_invoice_id, stripe_invoice_url = p_invoice_url,
    stripe_subtotal_cad = p_subtotal_cents::numeric / 100,
    stripe_tax_cad = p_tax_cents::numeric / 100, stripe_total_cad = p_total_cents::numeric / 100,
    updated_at = now() where id = p_purchase_id;

  insert into public.package_credit_events (purchase_id, event_type, quantity_delta, source_key, note)
  values (p_purchase_id, 'grant', v_purchase.credits_purchased,
    'stripe-purchase-grant:' || p_purchase_id::text, 'Credits granted after verified Stripe payment.')
  on conflict (source_key) do nothing;

  update public.bookings set payment_status = 'paid', status = 'confirmed',
    stripe_payment_intent_id = p_payment_intent_id, stripe_invoice_id = p_invoice_id,
    stripe_invoice_url = p_invoice_url, stripe_subtotal_cad = p_subtotal_cents::numeric / 100,
    stripe_tax_cad = p_tax_cents::numeric / 100, stripe_total_cad = p_total_cents::numeric / 100,
    stripe_currency = 'CAD', stripe_checkout_session_id = null,
    stripe_checkout_expires_at = null, updated_at = now()
  where id = any(v_scheduled_ids) and status = 'pending_payment' and payment_status = 'due';

  insert into public.package_credit_events (purchase_id, booking_id, event_type, quantity_delta, source_key, note)
  select p_purchase_id, b.id, 'redeem', -1,
    'stripe-purchase-redeem:' || p_purchase_id::text || ':' || b.id::text,
    'Lesson scheduled as part of the package checkout.'
  from public.bookings b where b.id = any(v_scheduled_ids)
  on conflict (source_key) do nothing;
  return true;
end;
$$;

revoke all on function public.fulfill_package_purchase_payment(text, uuid, text, text, text, text, bigint, bigint, bigint, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.fulfill_package_purchase_payment(text, uuid, text, text, text, text, bigint, bigint, bigint, text, timestamptz)
  to service_role;

create or replace function public.expire_package_purchase_checkout(p_event_id text, p_purchase_id uuid, p_session_id text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_purchase public.package_purchases%rowtype;
begin
  select * into v_purchase from public.package_purchases where id = p_purchase_id for update;
  if not found or v_purchase.source <> 'new' or v_purchase.payment_status <> 'pending' or
     v_purchase.stripe_checkout_session_id is distinct from p_session_id then return false; end if;
  insert into public.stripe_webhook_events (event_id, event_type)
  values (p_event_id, 'package_purchase_expired') on conflict (event_id) do nothing;
  if not found then return false; end if;
  update public.bookings set status = 'cancelled', stripe_checkout_expires_at = now(), updated_at = now()
  where purchase_id = p_purchase_id and status = 'pending_payment' and payment_status = 'due';
  update public.package_purchases set payment_status = 'failed', stripe_checkout_session_id = null,
    stripe_checkout_expires_at = null, stripe_checkout_attempt = stripe_checkout_attempt + 1,
    updated_at = now() where id = p_purchase_id;
  return true;
end;
$$;
revoke all on function public.expire_package_purchase_checkout(text, uuid, text) from public, anon, authenticated;
grant execute on function public.expire_package_purchase_checkout(text, uuid, text) to service_role;
