-- Unpaid bookings without an active Stripe Checkout may reserve time for ten
-- minutes only. Starting Checkout within that period sets the Stripe expiry on
-- the booking and extends its reservation for the life of that Checkout.

-- A 45-minute road-test appointment includes pre-test pickup and coordination,
-- so it occupies the same two-hour calendar block as a 90-minute lesson.
create or replace function public.booking_occupied_duration_min(p_duration_min integer)
returns integer
language sql
immutable
set search_path = pg_catalog
as $$
  select case when p_duration_min in (45, 90) then 120 else p_duration_min end;
$$;

revoke all on function public.booking_occupied_duration_min(integer) from public, anon, authenticated;
grant execute on function public.booking_occupied_duration_min(integer) to service_role;

update public.bookings b
set stripe_checkout_expires_at = least(
  coalesce(b.stripe_checkout_expires_at, b.created_at + interval '10 minutes'),
  b.created_at + interval '10 minutes'
)
where b.status = 'pending_payment'
  and b.payment_status = 'due'
  and not exists (
    select 1 from public.bookings checkout_owner
    where coalesce(checkout_owner.package_id, checkout_owner.id) = coalesce(b.package_id, b.id)
      and checkout_owner.stripe_checkout_session_id is not null
  );

create or replace function public.cap_unpaid_booking_hold()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.status = 'pending_payment'
     and new.payment_status = 'due'
     and new.stripe_checkout_session_id is null then
    new.stripe_checkout_expires_at := least(
      coalesce(new.stripe_checkout_expires_at, coalesce(new.created_at, now()) + interval '10 minutes'),
      coalesce(new.created_at, now()) + interval '10 minutes'
    );
  end if;
  return new;
end;
$$;

revoke all on function public.cap_unpaid_booking_hold() from public, anon, authenticated;
drop trigger if exists bookings_cap_unpaid_hold on public.bookings;
create trigger bookings_cap_unpaid_hold
before insert on public.bookings
for each row execute function public.cap_unpaid_booking_hold();

create or replace function public.require_active_hold_for_checkout()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if old.status = 'pending_payment'
     and old.payment_status = 'due'
     and old.stripe_checkout_session_id is null
     and new.stripe_checkout_session_id is not null
     and (old.stripe_checkout_expires_at is null or old.stripe_checkout_expires_at <= now()) then
    raise exception 'The unpaid booking hold has expired. Recheck availability before starting Checkout.';
  end if;
  return new;
end;
$$;

revoke all on function public.require_active_hold_for_checkout() from public, anon, authenticated;
drop trigger if exists bookings_require_active_hold_for_checkout on public.bookings;
create trigger bookings_require_active_hold_for_checkout
before update of stripe_checkout_session_id on public.bookings
for each row execute function public.require_active_hold_for_checkout();

-- Enforce the two-hour cadence at the database boundary as well as in the
-- calendar API, including for bookings created through the admin tools.
create or replace function public.guard_booking_date_availability_override()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_local_start timestamp;
  v_override public.availability_date_overrides%rowtype;
  v_minute integer;
  v_occupied integer;
  v_step integer;
begin
  v_local_start := new.starts_at at time zone 'America/Vancouver';
  select * into v_override from public.availability_date_overrides where date = v_local_start::date;
  if not found then return new; end if;
  v_minute := extract(hour from v_local_start)::integer * 60 + extract(minute from v_local_start)::integer;
  v_occupied := public.booking_occupied_duration_min(new.duration_min);
  v_step := case when new.duration_min in (45, 90) then 120 else 30 end;
  if v_minute < v_override.start_min or v_minute + v_occupied > v_override.end_min or
     mod(v_minute - v_override.start_min, v_step) <> 0 or extract(second from v_local_start) <> 0 then
    raise exception 'Booking time falls outside the date-specific availability window';
  end if;
  return new;
end;
$$;

create or replace function public.guard_booking_two_hour_package_cadence()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_local_start timestamp;
  v_weekday integer;
  v_minute integer;
  v_start_min integer;
  v_end_min integer;
  v_rule public.availability_rules%rowtype;
  v_override public.availability_date_overrides%rowtype;
begin
  if new.duration_min not in (45, 90) then return new; end if;
  v_local_start := new.starts_at at time zone 'America/Vancouver';
  v_weekday := extract(dow from v_local_start)::integer;
  v_minute := extract(hour from v_local_start)::integer * 60 + extract(minute from v_local_start)::integer;
  select * into v_rule from public.availability_rules where weekday = v_weekday;
  select * into v_override from public.availability_date_overrides where date = v_local_start::date;
  if found then
    v_start_min := v_override.start_min;
    v_end_min := v_override.end_min;
  else
    v_start_min := v_rule.start_min;
    v_end_min := v_rule.end_min;
  end if;
  if v_rule.weekday is null or v_minute < v_start_min or
     v_minute + public.booking_occupied_duration_min(new.duration_min) > v_end_min or
     mod(v_minute - v_start_min, 120) <> 0 or extract(second from v_local_start) <> 0 then
    raise exception 'Package bookings must use a valid two-hour appointment start';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_booking_two_hour_package_cadence() from public, anon, authenticated;
drop trigger if exists bookings_two_hour_package_cadence on public.bookings;
create trigger bookings_two_hour_package_cadence
before insert or update of starts_at, ends_at, duration_min on public.bookings
for each row execute function public.guard_booking_two_hour_package_cadence();

create or replace function public.guard_booking_slot_hold_cadence()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_local_start timestamp;
  v_weekday integer;
  v_minute integer;
  v_start_min integer;
  v_end_min integer;
  v_rule public.availability_rules%rowtype;
  v_override public.availability_date_overrides%rowtype;
begin
  if new.duration_min not in (45, 90) then return new; end if;
  v_local_start := new.starts_at at time zone 'America/Vancouver';
  v_weekday := extract(dow from v_local_start)::integer;
  v_minute := extract(hour from v_local_start)::integer * 60 + extract(minute from v_local_start)::integer;
  select * into v_rule from public.availability_rules where weekday = v_weekday;
  select * into v_override from public.availability_date_overrides where date = v_local_start::date;
  if found then
    v_start_min := v_override.start_min;
    v_end_min := v_override.end_min;
  else
    v_start_min := v_rule.start_min;
    v_end_min := v_rule.end_min;
  end if;
  if v_rule.weekday is null or v_minute < v_start_min or
     v_minute + public.booking_occupied_duration_min(new.duration_min) > v_end_min or
     mod(v_minute - v_start_min, 120) <> 0 or extract(second from v_local_start) <> 0 then
    raise exception 'Package holds must use a valid two-hour appointment start';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_booking_slot_hold_cadence() from public, anon, authenticated;
drop trigger if exists booking_slot_holds_two_hour_cadence on public.booking_slot_holds;
create trigger booking_slot_holds_two_hour_cadence
before insert or update of starts_at, duration_min on public.booking_slot_holds
for each row execute function public.guard_booking_slot_hold_cadence();

-- A missing expiry is not an indefinite reservation. Active Checkout holds
-- have an explicit expiry recorded by set_booking_checkout_session_with_addons.
create or replace function public.booking_overlaps(
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_exclude_booking_id uuid default null
) returns boolean
language sql
stable
set search_path = pg_catalog
as $$
  with candidate as (
    select public.booking_interval_occupied_end(p_starts_at, p_ends_at) as ends_at
  )
  select exists (
    select 1 from public.bookings b cross join candidate c
    where b.status in ('confirmed', 'rescheduled')
      and (p_exclude_booking_id is null or b.id <> p_exclude_booking_id)
      and b.starts_at < c.ends_at
      and p_starts_at < b.starts_at + make_interval(mins => public.booking_occupied_duration_min(b.duration_min))
  ) or exists (
    select 1 from public.bookings b cross join candidate c
    where b.status = 'pending_payment'
      and b.payment_status = 'due'
      and b.stripe_checkout_expires_at > now()
      and (p_exclude_booking_id is null or b.id <> p_exclude_booking_id)
      and b.starts_at < c.ends_at
      and p_starts_at < b.starts_at + make_interval(mins => public.booking_occupied_duration_min(b.duration_min))
  ) or exists (
    select 1 from public.booking_upgrade_slots s cross join candidate c
    where (p_exclude_booking_id is null or s.booking_id <> p_exclude_booking_id)
      and s.starts_at < c.ends_at
      and p_starts_at < public.booking_interval_occupied_end(s.starts_at, s.ends_at)
  );
$$;

revoke all on function public.booking_overlaps(timestamptz, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.booking_overlaps(timestamptz, timestamptz, uuid) to service_role;

-- Cash can be recorded only after any Checkout is closed and the expired
-- booking's complete package schedule is still valid. Serialize against
-- concurrent holds/bookings by taking the existing per-day booking locks.
create or replace function public.mark_booking_paid_by_cash(p_booking_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_booking public.bookings%rowtype;
  v_package_id uuid;
  v_session record;
  v_local_start timestamp;
  v_weekday integer;
  v_minute integer;
  v_occupied integer;
  v_rule public.availability_rules%rowtype;
  v_override public.availability_date_overrides%rowtype;
begin
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found or v_booking.payment_status <> 'due' or
     v_booking.status in ('cancelled', 'completed') then
    return false;
  end if;
  v_package_id := coalesce(v_booking.package_id, v_booking.id);

  perform public.lock_booking_day(b.starts_at)
  from public.bookings b
  where coalesce(b.package_id, b.id) = v_package_id
  order by b.starts_at;

  for v_session in
    select * from public.bookings b
    where coalesce(b.package_id, b.id) = v_package_id and b.payment_status = 'due'
    order by b.starts_at
  loop
    if v_session.status = 'pending_payment' and
       (v_session.stripe_checkout_expires_at is null or v_session.stripe_checkout_expires_at <= now()) then
      v_local_start := v_session.starts_at at time zone 'America/Vancouver';
      v_weekday := extract(dow from v_local_start)::integer;
      v_minute := extract(hour from v_local_start)::integer * 60 + extract(minute from v_local_start)::integer;
      v_occupied := public.booking_occupied_duration_min(v_session.duration_min);
      select * into v_rule from public.availability_rules where weekday = v_weekday;
      select * into v_override from public.availability_date_overrides where date = v_local_start::date;
      if not found then
        v_override.start_min := null;
        v_override.end_min := null;
      end if;
      if v_rule.weekday is null or
         v_minute < coalesce(v_override.start_min, v_rule.start_min) or
         v_minute + v_occupied > coalesce(v_override.end_min, v_rule.end_min) or
          mod(v_minute - coalesce(v_override.start_min, v_rule.start_min), case when v_session.duration_min in (45, 90) then 120 else 30 end) <> 0 or
         extract(second from v_local_start) <> 0 or
         exists (select 1 from public.blackout_dates where date = v_local_start::date) or
         exists (
           select 1 from public.bookings b
           where coalesce(b.package_id, b.id) <> v_package_id
             and (b.status in ('confirmed', 'rescheduled') or
               (b.status = 'pending_payment' and b.payment_status = 'due' and b.stripe_checkout_expires_at > now()))
             and b.starts_at < v_session.starts_at + make_interval(mins => v_occupied)
             and v_session.starts_at < b.starts_at + make_interval(mins => public.booking_occupied_duration_min(b.duration_min))
         ) or exists (
           select 1 from public.booking_upgrade_slots s
           join public.bookings anchor on anchor.id = s.booking_id
           where coalesce(anchor.package_id, anchor.id) <> v_package_id
             and s.starts_at < v_session.starts_at + make_interval(mins => v_occupied)
             and v_session.starts_at < public.booking_interval_occupied_end(s.starts_at, s.ends_at)
         ) or exists (
           select 1 from public.booking_slot_holds h
           where h.expires_at > now()
             and h.starts_at < v_session.starts_at + make_interval(mins => v_occupied)
             and v_session.starts_at < h.starts_at + make_interval(mins => public.booking_occupied_duration_min(h.duration_min))
         ) then
        return false;
      end if;
    end if;
  end loop;

  update public.bookings
  set payment_status = 'paid',
      status = case when status = 'pending_payment' then 'confirmed' else status end,
      stripe_checkout_expires_at = null,
      updated_at = now()
  where coalesce(package_id, id) = v_package_id and payment_status = 'due';
  return found;
end;
$$;

revoke all on function public.mark_booking_paid_by_cash(uuid) from public, anon, authenticated;
grant execute on function public.mark_booking_paid_by_cash(uuid) to service_role;
