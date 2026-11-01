alter table public.bookings
  add column if not exists stripe_upgrade_target_sessions jsonb;

create table if not exists public.booking_upgrade_slots (
  booking_id uuid not null references public.bookings(id) on delete cascade,
  session_index integer not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  primary key (booking_id, session_index),
  check (ends_at > starts_at)
);
create index if not exists booking_upgrade_slots_range_idx on public.booking_upgrade_slots (starts_at, ends_at);
revoke all on public.booking_upgrade_slots from public, anon, authenticated;
grant all on public.booking_upgrade_slots to service_role;

create or replace function public.booking_overlaps(p_starts_at timestamptz, p_ends_at timestamptz, p_exclude_booking_id uuid default null)
returns boolean language sql stable set search_path = pg_catalog
as $$
  select exists (
    select 1 from public.bookings b
    where b.status in ('confirmed','rescheduled')
      and (p_exclude_booking_id is null or b.id <> p_exclude_booking_id)
      and b.starts_at < p_ends_at and p_starts_at < b.ends_at
  ) or exists (
    select 1 from public.bookings b
    where b.status = 'pending_payment' and b.payment_status = 'due'
      and (b.stripe_checkout_expires_at is null or b.stripe_checkout_expires_at > now())
      and (p_exclude_booking_id is null or b.id <> p_exclude_booking_id)
      and b.starts_at < p_ends_at and p_starts_at < b.ends_at
  ) or exists (
    select 1 from public.booking_upgrade_slots s
    where (p_exclude_booking_id is null or s.booking_id <> p_exclude_booking_id)
      and s.starts_at < p_ends_at and p_starts_at < s.ends_at
  );
$$;

drop function if exists public.set_booking_package_upgrade_checkout(uuid, text, text, text, integer, numeric, numeric, numeric, timestamptz);
create function public.set_booking_package_upgrade_checkout(
  p_booking_id uuid, p_session_id text, p_target_lesson_id text, p_target_lesson_name text,
  p_target_duration_min integer, p_target_price_cad numeric, p_from_price_cad numeric,
  p_amount_cad numeric, p_expected_starts_at timestamptz, p_sessions jsonb
) returns boolean language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_anchor public.bookings%rowtype;
  v_count integer;
  v_eligible integer;
  v_item record;
  v_index integer := 0;
begin
  select * into v_anchor from public.bookings where id = p_booking_id for update;
  if not found or v_anchor.session_index <> 1 or v_anchor.starts_at <> p_expected_starts_at
     or v_anchor.package_price_cad <> p_from_price_cad or v_anchor.payment_status <> 'paid'
     or v_anchor.status not in ('confirmed','rescheduled') or v_anchor.stripe_upgrade_checkout_session_id is not null
     or p_target_price_cad <= p_from_price_cad or p_target_duration_min < 15
     or p_amount_cad <> round((p_target_price_cad - p_from_price_cad) * 100) / 100
     or jsonb_typeof(p_sessions) <> 'array' or jsonb_array_length(p_sessions) <> v_anchor.session_count then
    return false;
  end if;
  select count(*), count(*) filter (where payment_status = 'paid' and status in ('confirmed','rescheduled'))
    into v_count, v_eligible from public.bookings where package_id = v_anchor.package_id;
  if v_count <> v_anchor.session_count or v_eligible <> v_count then return false; end if;

  for v_item in
    select value as item from jsonb_array_elements(p_sessions) order by (value->>'startsAt')
  loop
    v_index := v_index + 1;
    if (v_item.item->>'startsAt')::timestamptz < now() + interval '120 minutes'
       or (v_item.item->>'endsAt')::timestamptz <> (v_item.item->>'startsAt')::timestamptz + make_interval(mins => p_target_duration_min)
       then
      return false;
    end if;
    perform public.lock_booking_day((v_item.item->>'startsAt')::timestamptz);
  end loop;
  if exists (
    select 1 from jsonb_array_elements(p_sessions) a join jsonb_array_elements(p_sessions) b
      on (a.value->>'startsAt') < (b.value->>'startsAt')
      and (a.value->>'startsAt')::timestamptz < (b.value->>'endsAt')::timestamptz
      and (b.value->>'startsAt')::timestamptz < (a.value->>'endsAt')::timestamptz
  ) then return false; end if;
  if exists (
    select 1 from jsonb_array_elements(p_sessions) s
    where exists (
      select 1 from public.bookings b
      where b.package_id <> v_anchor.package_id
        and (b.status in ('confirmed','rescheduled') or
          (b.status = 'pending_payment' and b.payment_status = 'due' and
           (b.stripe_checkout_expires_at is null or b.stripe_checkout_expires_at > now())))
        and b.starts_at < (s.value->>'endsAt')::timestamptz
        and (s.value->>'startsAt')::timestamptz < b.ends_at
    ) or exists (
      select 1 from public.booking_upgrade_slots r
      where r.booking_id <> p_booking_id
        and r.starts_at < (s.value->>'endsAt')::timestamptz
        and (s.value->>'startsAt')::timestamptz < r.ends_at
    )
  ) then return false; end if;
  delete from public.booking_upgrade_slots where booking_id = p_booking_id;
  v_index := 0;
  for v_item in
    select value as item from jsonb_array_elements(p_sessions) order by (value->>'startsAt')
  loop
    v_index := v_index + 1;
    insert into public.booking_upgrade_slots(booking_id, session_index, starts_at, ends_at)
    values (p_booking_id, v_index, (v_item.item->>'startsAt')::timestamptz, (v_item.item->>'endsAt')::timestamptz);
  end loop;
  if exists (
    select 1 from public.booking_upgrade_slots a join public.booking_upgrade_slots b
      on a.booking_id = b.booking_id and a.session_index < b.session_index
      and a.starts_at < b.ends_at and b.starts_at < a.ends_at
    where a.booking_id = p_booking_id
  ) then return false; end if;
  update public.bookings set stripe_upgrade_checkout_session_id = p_session_id,
    stripe_upgrade_from_price_cad = p_from_price_cad, stripe_upgrade_target_lesson_id = p_target_lesson_id,
    stripe_upgrade_target_lesson_name = p_target_lesson_name, stripe_upgrade_target_duration_min = p_target_duration_min,
    stripe_upgrade_target_price_cad = p_target_price_cad, stripe_upgrade_amount_cad = p_amount_cad,
    stripe_upgrade_target_sessions = p_sessions where id = p_booking_id;
  return true;
exception when others then
  delete from public.booking_upgrade_slots where booking_id = p_booking_id;
  raise;
end;
$$;
revoke execute on function public.set_booking_package_upgrade_checkout(uuid, text, text, text, integer, numeric, numeric, numeric, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.set_booking_package_upgrade_checkout(uuid, text, text, text, integer, numeric, numeric, numeric, timestamptz, jsonb) to service_role;

create or replace function public.record_stripe_upgrade_checkout_event(
  p_event_id text, p_event_type text, p_booking_id uuid, p_session_id text,
  p_payment_intent_id text default null, p_invoice_id text default null, p_invoice_url text default null,
  p_subtotal_cents bigint default null, p_tax_cents bigint default null, p_total_cents bigint default null,
  p_currency text default null, p_target_lesson_id text default null, p_target_lesson_name text default null,
  p_target_duration_min integer default null, p_target_price_cad numeric default null, p_from_price_cad numeric default null
) returns boolean language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_anchor public.bookings%rowtype;
  v_total_cents bigint;
begin
  select * into v_anchor from public.bookings where id = p_booking_id for update;
  if not found then return false; end if;
  insert into public.stripe_webhook_events(event_id, event_type) values (p_event_id, 'upgrade_' || p_event_type) on conflict (event_id) do nothing;
  if not found then return false; end if;
  if p_event_type = 'paid' then
    if v_anchor.stripe_upgrade_checkout_session_id <> p_session_id or v_anchor.payment_status <> 'paid'
       or v_anchor.stripe_upgrade_from_price_cad <> p_from_price_cad
       or v_anchor.stripe_upgrade_target_lesson_id <> p_target_lesson_id
       or v_anchor.stripe_upgrade_target_lesson_name <> p_target_lesson_name
       or v_anchor.stripe_upgrade_target_duration_min <> p_target_duration_min
       or v_anchor.stripe_upgrade_target_price_cad <> p_target_price_cad
       or p_target_price_cad <= p_from_price_cad
       or (select count(*) from public.booking_upgrade_slots where booking_id = p_booking_id) <> v_anchor.session_count then
      return false;
    end if;
    v_total_cents := round(p_target_price_cad * 100)::bigint;
    update public.bookings b set
      lesson_id = p_target_lesson_id, lesson_name = p_target_lesson_name, duration_min = p_target_duration_min,
      starts_at = s.starts_at, ends_at = s.ends_at, package_price_cad = p_target_price_cad,
      price_cad = (v_total_cents / b.session_count + case when b.session_index <= mod(v_total_cents, b.session_count) then 1 else 0 end)::numeric / 100,
      stripe_payment_intent_id = p_payment_intent_id, stripe_invoice_id = p_invoice_id, stripe_invoice_url = p_invoice_url,
      stripe_subtotal_cad = case when p_subtotal_cents is null then null else p_subtotal_cents::numeric / 100 end,
      stripe_tax_cad = case when p_tax_cents is null then null else p_tax_cents::numeric / 100 end,
      stripe_total_cad = case when p_total_cents is null then null else p_total_cents::numeric / 100 end,
      stripe_currency = lower(coalesce(p_currency, 'cad')), updated_at = now()
    from public.booking_upgrade_slots s
    where b.package_id = v_anchor.package_id and s.booking_id = p_booking_id and s.session_index = b.session_index;
    delete from public.booking_upgrade_slots where booking_id = p_booking_id;
    update public.bookings set stripe_upgrade_checkout_session_id = null, stripe_upgrade_attempt = stripe_upgrade_attempt + 1,
      stripe_upgrade_from_price_cad = null, stripe_upgrade_target_lesson_id = null,
      stripe_upgrade_target_lesson_name = null, stripe_upgrade_target_duration_min = null,
      stripe_upgrade_target_price_cad = null, stripe_upgrade_amount_cad = null, stripe_upgrade_target_sessions = null
    where id = p_booking_id;
  elsif p_event_type = 'expired' then
    delete from public.booking_upgrade_slots where booking_id = p_booking_id;
    update public.bookings set stripe_upgrade_checkout_session_id = null,
      stripe_upgrade_attempt = stripe_upgrade_attempt + 1, stripe_upgrade_target_sessions = null,
      stripe_upgrade_from_price_cad = null, stripe_upgrade_target_lesson_id = null,
      stripe_upgrade_target_lesson_name = null, stripe_upgrade_target_duration_min = null,
      stripe_upgrade_target_price_cad = null, stripe_upgrade_amount_cad = null, updated_at = now()
    where id = p_booking_id and stripe_upgrade_checkout_session_id = p_session_id;
  else raise exception 'Unsupported Stripe upgrade event kind: %', p_event_type;
  end if;
  return true;
end;
$$;
revoke execute on function public.record_stripe_upgrade_checkout_event(text, text, uuid, text, text, text, text, bigint, bigint, bigint, text, text, text, integer, numeric, numeric) from public, anon, authenticated;
grant execute on function public.record_stripe_upgrade_checkout_event(text, text, uuid, text, text, text, text, bigint, bigint, bigint, text, text, text, integer, numeric, numeric) to service_role;
