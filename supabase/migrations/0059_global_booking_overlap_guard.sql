-- Serialize overlap checks across every occupied local calendar day. This is
-- especially important for admin custom-time bookings that can cross midnight.
-- Keep the trigger authoritative even when trusted admin RPCs enable the
-- availability override flag: the flag bypasses public hours, never conflicts.
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
  v_start_min integer;
  v_end_min integer;
  v_occupied_min integer;
  v_rule public.availability_rules%rowtype;
  v_override public.availability_date_overrides%rowtype;
  v_occupied_end timestamptz;
begin
  if new.starts_at is null or new.ends_at is null or new.duration_min is null or
     new.ends_at <> new.starts_at + make_interval(mins => new.duration_min) then
    raise exception 'Lesson end must continue to represent the actual lesson duration.';
  end if;

  if new.status not in ('pending_payment', 'confirmed', 'rescheduled') then return new; end if;
  v_occupied_min := public.booking_occupied_duration_min(new.duration_min);
  v_occupied_end := new.starts_at + make_interval(mins => v_occupied_min);

  -- Lock each Pacific calendar date occupied by the candidate in chronological order.
  perform public.lock_booking_day(new.starts_at);
  if ((v_occupied_end - interval '1 second') at time zone 'America/Vancouver')::date <> (new.starts_at at time zone 'America/Vancouver')::date then
    perform public.lock_booking_day(v_occupied_end - interval '1 second');
  end if;

  if current_setting('app.admin_calendar_override', true) = 'on' then
    if public.booking_overlaps(new.starts_at, new.ends_at, new.id) then
      raise exception 'The occupied appointment block conflicts with another booking.';
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
  if v_rule.weekday is null or v_minute < v_start_min or v_minute + v_occupied_min > v_end_min or
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
