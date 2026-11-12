-- Keep the database booking guards aligned with the calendar: a date-specific
-- override replaces that weekday's regular availability window.
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
  v_start_min integer;
  v_end_min integer;
  v_rule public.availability_rules%rowtype;
  v_override public.availability_date_overrides%rowtype;
begin
  if current_setting('app.admin_calendar_override', true) = 'on' then
    if new.starts_at is null or new.ends_at is null or new.duration_min is null or
       new.ends_at <> new.starts_at + make_interval(mins => new.duration_min) then
      raise exception 'Lesson end must continue to represent the actual lesson duration.';
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and exists (
    select 1 from public.bookings anchor
    join public.booking_upgrade_slots reserved on reserved.booking_id = anchor.id
    where anchor.package_id = new.package_id and anchor.session_index = 1
      and reserved.session_index = new.session_index
      and reserved.starts_at = new.starts_at and reserved.ends_at = new.ends_at
  ) then return new; end if;
  if new.status not in ('pending_payment', 'confirmed', 'rescheduled') then return new; end if;
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
  select * into v_override from public.availability_date_overrides where date = v_local_start::date;
  if found then
    v_start_min := v_override.start_min;
    v_end_min := v_override.end_min;
  else
    v_start_min := v_rule.start_min;
    v_end_min := v_rule.end_min;
  end if;
  if v_start_min is null or v_minute < v_start_min or v_minute + v_occupied_min > v_end_min or
     mod(v_minute - v_start_min, public.booking_start_cadence_min(new.duration_min)) <> 0 or
     extract(second from v_local_start) <> 0 or
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
grant execute on function public.guard_booking_occupied_slot() to service_role;

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
  if current_setting('app.admin_calendar_override', true) = 'on' then return new; end if;
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
  if v_start_min is null or v_minute < v_start_min or
     v_minute + public.booking_occupied_duration_min(new.duration_min) > v_end_min or
     mod(v_minute - v_start_min, public.booking_start_cadence_min(new.duration_min)) <> 0 or
     extract(second from v_local_start) <> 0 then
    raise exception 'Package booking must use a valid appointment start time';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_booking_two_hour_package_cadence() from public, anon, authenticated;
grant execute on function public.guard_booking_two_hour_package_cadence() to service_role;
