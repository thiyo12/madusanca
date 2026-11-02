-- Keep the customer-visible lesson duration unchanged while reserving the
-- instructor's full occupied time for availability and atomic conflict checks.
create or replace function public.booking_occupied_duration_min(p_duration_min integer)
returns integer
language sql
immutable
set search_path = pg_catalog
as $$
  select case when p_duration_min = 90 then 120 else p_duration_min end;
$$;

create or replace function public.booking_interval_occupied_end(
  p_starts_at timestamptz,
  p_ends_at timestamptz
) returns timestamptz
language sql
immutable
set search_path = pg_catalog
as $$
  select p_starts_at + make_interval(mins => public.booking_occupied_duration_min(
    floor(extract(epoch from (p_ends_at - p_starts_at)) / 60)::integer
  ));
$$;

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
    select 1
    from public.bookings b cross join candidate c
    where b.status in ('confirmed', 'rescheduled')
      and (p_exclude_booking_id is null or b.id <> p_exclude_booking_id)
      and b.starts_at < c.ends_at
      and p_starts_at < b.starts_at + make_interval(mins => public.booking_occupied_duration_min(b.duration_min))
  ) or exists (
    select 1
    from public.bookings b cross join candidate c
    where b.status = 'pending_payment'
      and b.payment_status = 'due'
      and (b.stripe_checkout_expires_at is null or b.stripe_checkout_expires_at > now())
      and (p_exclude_booking_id is null or b.id <> p_exclude_booking_id)
      and b.starts_at < c.ends_at
      and p_starts_at < b.starts_at + make_interval(mins => public.booking_occupied_duration_min(b.duration_min))
  ) or exists (
    select 1
    from public.booking_upgrade_slots s cross join candidate c
    where (p_exclude_booking_id is null or s.booking_id <> p_exclude_booking_id)
      and s.starts_at < c.ends_at
      and p_starts_at < public.booking_interval_occupied_end(s.starts_at, s.ends_at)
  );
$$;

revoke all on function public.booking_occupied_duration_min(integer) from public, anon, authenticated;
revoke all on function public.booking_interval_occupied_end(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.booking_overlaps(timestamptz, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.booking_occupied_duration_min(integer) to service_role;
grant execute on function public.booking_interval_occupied_end(timestamptz, timestamptz) to service_role;
grant execute on function public.booking_overlaps(timestamptz, timestamptz, uuid) to service_role;

-- Upgrade slot reservations are stored with the lesson's actual end time.
-- Validate them atomically against expanded lesson occupancy, including other
-- proposed sessions for the same package and concurrently reserved upgrades.
create or replace function public.guard_booking_upgrade_slot_occupancy()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_package_id uuid;
  v_candidate_end timestamptz;
begin
  select b.package_id into v_package_id
  from public.bookings b
  where b.id = new.booking_id;
  if not found then
    raise exception 'Booking upgrade anchor was not found.';
  end if;

  perform public.lock_booking_day(new.starts_at);
  v_candidate_end := public.booking_interval_occupied_end(new.starts_at, new.ends_at);

  if exists (
    select 1
    from public.bookings b
    where b.package_id <> v_package_id
      and (b.status in ('confirmed', 'rescheduled') or
        (b.status = 'pending_payment' and b.payment_status = 'due' and
         (b.stripe_checkout_expires_at is null or b.stripe_checkout_expires_at > now())))
      and b.starts_at < v_candidate_end
      and new.starts_at < b.starts_at + make_interval(mins => public.booking_occupied_duration_min(b.duration_min))
  ) or exists (
    select 1
    from public.booking_upgrade_slots s
    where (s.booking_id <> new.booking_id or s.session_index <> new.session_index)
      and s.starts_at < v_candidate_end
      and new.starts_at < public.booking_interval_occupied_end(s.starts_at, s.ends_at)
  ) then
    raise exception 'Requested upgrade session conflicts with another booking.';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_booking_upgrade_slot_occupancy() from public, anon, authenticated;
drop trigger if exists booking_upgrade_slot_occupancy_guard on public.booking_upgrade_slots;
create trigger booking_upgrade_slot_occupancy_guard
before insert or update of starts_at, ends_at, booking_id on public.booking_upgrade_slots
for each row execute function public.guard_booking_upgrade_slot_occupancy();

-- Enforce the same occupied interval and schedule-window rule at the final
-- database write. This also protects multi-session inserts from overlapping
-- with one another after the first row has been inserted in the transaction.
create or replace function public.guard_booking_occupied_slot()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_local_start timestamp;
  v_weekday integer;
  v_minute integer;
  v_occupied_min integer;
  v_rule public.availability_rules%rowtype;
begin
  if tg_op = 'UPDATE' and exists (
    select 1
    from public.bookings anchor
    join public.booking_upgrade_slots reserved
      on reserved.booking_id = anchor.id
    where anchor.package_id = new.package_id
      and anchor.session_index = 1
      and reserved.session_index = new.session_index
      and reserved.starts_at = new.starts_at
      and reserved.ends_at = new.ends_at
  ) then
    -- Upgrade fulfillment has already atomically reserved and validated these
    -- exact target slots in set_booking_package_upgrade_checkout().
    return new;
  end if;

  if new.status not in ('pending_payment', 'confirmed', 'rescheduled') then
    return new;
  end if;

  if new.starts_at is null or new.ends_at is null or new.duration_min is null or
     new.ends_at <> new.starts_at + make_interval(mins => new.duration_min) then
    raise exception 'Lesson end must continue to represent the actual lesson duration.';
  end if;

  perform public.lock_booking_day(new.starts_at);
  v_local_start := new.starts_at at time zone 'America/Vancouver';
  v_weekday := extract(dow from v_local_start)::integer;
  v_minute := extract(hour from v_local_start)::integer * 60 + extract(minute from v_local_start)::integer;
  v_occupied_min := public.booking_occupied_duration_min(new.duration_min);
  select * into v_rule from public.availability_rules where weekday = v_weekday;

  if not found or v_minute < v_rule.start_min or v_minute + v_occupied_min > v_rule.end_min or
     v_minute % 30 <> 0 or extract(second from v_local_start) <> 0 or
     exists (select 1 from public.blackout_dates where date = v_local_start::date) then
    raise exception 'The occupied appointment block is outside current booking hours.';
  end if;

  if public.booking_overlaps(new.starts_at, new.ends_at, new.id) then
    raise exception 'The occupied appointment block conflicts with another booking.';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_booking_occupied_slot() from public, anon, authenticated;
drop trigger if exists bookings_occupied_slot_guard on public.bookings;
create trigger bookings_occupied_slot_guard
before insert or update of starts_at, ends_at, duration_min on public.bookings
for each row execute function public.guard_booking_occupied_slot();
