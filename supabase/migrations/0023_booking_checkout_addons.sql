-- Preserve add-on purchases as separate package-credit records while charging
-- them with the initial booking in one Stripe Checkout Session.
create table if not exists public.booking_checkout_addon_attempts (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id),
  stripe_checkout_session_id text not null unique,
  status text not null default 'pending' check (status in ('pending', 'paid', 'expired')),
  created_at timestamptz not null default now()
);

create table if not exists public.booking_checkout_addon_items (
  attempt_id uuid not null references public.booking_checkout_addon_attempts(id),
  purchase_id uuid not null unique references public.package_purchases(id),
  lesson_id text not null,
  primary key (attempt_id, purchase_id)
);

create index if not exists booking_checkout_addon_attempts_booking_idx
  on public.booking_checkout_addon_attempts (booking_id, created_at desc);
create index if not exists booking_checkout_addon_items_attempt_idx
  on public.booking_checkout_addon_items (attempt_id, lesson_id);

alter table public.booking_checkout_addon_attempts enable row level security;
alter table public.booking_checkout_addon_items enable row level security;
revoke all on public.booking_checkout_addon_attempts, public.booking_checkout_addon_items from public, anon, authenticated;
grant select, insert, update, delete on public.booking_checkout_addon_attempts, public.booking_checkout_addon_items to service_role;

-- Atomically bind the booking hold and the catalogue-priced add-on snapshots to
-- the same Checkout Session. Prices and credit counts are read from the server-
-- controlled lesson catalogue, never supplied by the browser.
create or replace function public.set_booking_checkout_session_with_addons(
  p_booking_id uuid,
  p_session_id text,
  p_expires_at timestamptz,
  p_expected_starts_at timestamptz,
  p_addon_lesson_ids text[] default '{}'
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_booking public.bookings%rowtype;
  v_attempt_id uuid;
  v_lesson public.lessons%rowtype;
  v_purchase_id uuid;
  v_ids text[] := coalesce(p_addon_lesson_ids, '{}');
  v_saved_ids text[];
begin
  if p_session_id is null or length(p_session_id) < 8 or p_expires_at <= now() or
     cardinality(v_ids) > 10 or cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) x) then
    return false;
  end if;
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found or v_booking.status not in ('pending_payment', 'confirmed', 'rescheduled') or
     v_booking.payment_status <> 'due' or v_booking.starts_at <> p_expected_starts_at then
    return false;
  end if;

  select id into v_attempt_id from public.booking_checkout_addon_attempts
  where stripe_checkout_session_id = p_session_id and booking_id = p_booking_id;
  if found then
    select coalesce(array_agg(lesson_id order by lesson_id), '{}') into v_saved_ids
    from public.booking_checkout_addon_items where attempt_id = v_attempt_id;
    select coalesce(array_agg(x order by x), '{}') into v_ids from unnest(v_ids) x;
    return v_booking.stripe_checkout_session_id = p_session_id and v_saved_ids = v_ids;
  end if;

  if exists (select 1 from unnest(v_ids) x where x = v_booking.lesson_id) or
     (select count(*) from public.lessons where id = any(v_ids) and category = 'package') <> cardinality(v_ids) then
    return false;
  end if;

  update public.bookings
  set stripe_checkout_session_id = p_session_id,
      stripe_checkout_expires_at = p_expires_at,
      updated_at = now()
  where id = p_booking_id;

  insert into public.booking_checkout_addon_attempts (booking_id, stripe_checkout_session_id)
  values (p_booking_id, p_session_id)
  returning id into v_attempt_id;

  for v_lesson in
    select * from public.lessons where id = any(v_ids) and category = 'package'
  loop
    insert into public.package_purchases (
      reference, student_name, email, phone, notes, lesson_id, lesson_name,
      duration_min, credits_purchased, amount_cad, currency, payment_status, source
    ) values (
      'WDA-A-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
      v_booking.student_name, v_booking.email, v_booking.phone, '',
      v_lesson.id, v_lesson.name, v_lesson.duration_min, v_lesson.session_count,
      v_lesson.price_cad, 'cad', 'pending', 'new'
    ) returning id into v_purchase_id;
    insert into public.booking_checkout_addon_items (attempt_id, purchase_id, lesson_id)
    values (v_attempt_id, v_purchase_id, v_lesson.id);
  end loop;
  return true;
end;
$$;

revoke all on function public.set_booking_checkout_session_with_addons(uuid, text, timestamptz, timestamptz, text[])
  from public, anon, authenticated;
grant execute on function public.set_booking_checkout_session_with_addons(uuid, text, timestamptz, timestamptz, text[])
  to service_role;

-- Extend the established payment RPC: a valid payment marks the booking paid
-- and grants each selected add-on's credits in the same transaction. Repeated
-- Stripe event delivery remains idempotent through stripe_webhook_events and
-- the unique credit source key.
create or replace function public.record_stripe_checkout_event(
  p_event_id text,
  p_event_type text,
  p_booking_id uuid,
  p_session_id text,
  p_payment_intent_id text default null,
  p_invoice_id text default null,
  p_invoice_url text default null,
  p_subtotal_cents bigint default null,
  p_tax_cents bigint default null,
  p_total_cents bigint default null,
  p_currency text default null
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_booking public.bookings%rowtype;
  v_package_id uuid;
  v_addon_total_cents bigint;
  v_attempt_id uuid;
  v_paid_at timestamptz := now();
  v_valid_until timestamptz;
  v_updated integer;
begin
  if p_event_type not in ('paid', 'expired') then
    raise exception 'Unsupported Stripe checkout event kind: %', p_event_type;
  end if;
  select * into v_booking from public.bookings
  where id = p_booking_id and stripe_checkout_session_id = p_session_id for update;
  if not found then return false; end if;
  if v_booking.payment_status <> 'due' then return false; end if;
  v_package_id := v_booking.package_id;

  select a.id into v_attempt_id from public.booking_checkout_addon_attempts a
  where a.booking_id = p_booking_id and a.stripe_checkout_session_id = p_session_id for update;
  select coalesce(round(sum(p.amount_cad * 100))::bigint, 0) into v_addon_total_cents
  from public.booking_checkout_addon_items i
  join public.package_purchases p on p.id = i.purchase_id
  where i.attempt_id = v_attempt_id;

  if p_event_type = 'paid' and (
    p_subtotal_cents is distinct from round((v_booking.package_price_cad + v_addon_total_cents::numeric / 100) * 100)::bigint or
    p_tax_cents is null or p_tax_cents < 0 or p_total_cents is distinct from p_subtotal_cents + p_tax_cents or
    lower(coalesce(p_currency, '')) <> 'cad'
  ) then
    return false;
  end if;

  insert into public.stripe_webhook_events (event_id, event_type)
  values (p_event_id, p_event_type)
  on conflict (event_id) do nothing;
  if not found then return false; end if;

  if p_event_type = 'paid' then
    update public.bookings
    set payment_status = 'paid',
        status = case when status = 'pending_payment' then 'confirmed' else status end,
        stripe_payment_intent_id = p_payment_intent_id,
        stripe_invoice_id = p_invoice_id,
        stripe_invoice_url = p_invoice_url,
        stripe_subtotal_cad = p_subtotal_cents::numeric / 100,
        stripe_tax_cad = p_tax_cents::numeric / 100,
        stripe_total_cad = p_total_cents::numeric / 100,
        stripe_currency = lower(coalesce(p_currency, 'cad')),
        stripe_checkout_expires_at = null,
        updated_at = now()
    where package_id = v_package_id and payment_status = 'due';
    get diagnostics v_updated = row_count;
    if v_updated = 0 then
      raise exception 'Checkout payment no longer matches a payable booking';
    end if;

    if v_attempt_id is not null then
      v_valid_until := (v_paid_at at time zone 'America/Vancouver' + interval '6 months') at time zone 'America/Vancouver';
      update public.package_purchases p
      set payment_status = 'paid', purchased_at = v_paid_at, valid_until = v_valid_until,
          stripe_payment_intent_id = p_payment_intent_id,
          stripe_invoice_id = p_invoice_id, stripe_invoice_url = p_invoice_url,
          stripe_subtotal_cad = p.amount_cad, updated_at = now()
      from public.booking_checkout_addon_items i
      where i.attempt_id = v_attempt_id and p.id = i.purchase_id and p.payment_status = 'pending';

      insert into public.package_credit_events (purchase_id, event_type, quantity_delta, source_key, note)
      select p.id, 'grant', p.credits_purchased,
        'booking-addon-grant:' || p.id::text,
        'Credits granted after verified combined booking and add-on payment.'
      from public.booking_checkout_addon_items i
      join public.package_purchases p on p.id = i.purchase_id
      where i.attempt_id = v_attempt_id
      on conflict (source_key) do nothing;
      update public.booking_checkout_addon_attempts set status = 'paid' where id = v_attempt_id;
    end if;
  elsif p_event_type = 'expired' then
    update public.bookings
    set stripe_checkout_session_id = null,
        stripe_checkout_expires_at = case when status = 'pending_payment' then now() else null end,
        stripe_checkout_attempt = stripe_checkout_attempt + 1,
        updated_at = now()
    where id = p_booking_id and stripe_checkout_session_id = p_session_id and payment_status = 'due';
    if v_attempt_id is not null then
      update public.package_purchases p set payment_status = 'failed', updated_at = now()
      from public.booking_checkout_addon_items i
      where i.attempt_id = v_attempt_id and p.id = i.purchase_id and p.payment_status = 'pending';
      update public.booking_checkout_addon_attempts set status = 'expired' where id = v_attempt_id;
    end if;
  else
    raise exception 'Unsupported Stripe checkout event kind: %', p_event_type;
  end if;
  return true;
end;
$$;

revoke all on function public.record_stripe_checkout_event(text, text, uuid, text, text, text, text, bigint, bigint, bigint, text)
  from public, anon, authenticated;
grant execute on function public.record_stripe_checkout_event(text, text, uuid, text, text, text, text, bigint, bigint, bigint, text)
  to service_role;
