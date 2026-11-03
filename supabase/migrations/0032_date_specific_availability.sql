-- One-off shorter availability windows for a specific Pacific calendar date.
-- Fully closed dates continue to use blackout_dates.
create table public.availability_date_overrides (
  date date primary key,
  start_min integer not null check (start_min between 0 and 1439),
  end_min integer not null check (end_min between 1 and 1440),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_min > start_min)
);

alter table public.availability_date_overrides enable row level security;
revoke all on public.availability_date_overrides from public, anon, authenticated;
grant select on public.availability_date_overrides to service_role;

create or replace function public.set_availability_date_override(
  p_date date,
  p_start_min integer,
  p_end_min integer
) returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_weekday integer;
  v_weekly_rule public.availability_rules%rowtype;
begin
  if p_date is null or p_date < (now() at time zone 'America/Vancouver')::date or
     p_start_min is null or p_end_min is null or p_start_min < 0 or p_start_min > 1439 or
     p_end_min < 1 or p_end_min > 1440 or p_end_min <= p_start_min then
    raise exception 'Invalid date-specific availability window';
  end if;
  v_weekday := extract(dow from p_date)::integer;
  select * into v_weekly_rule from public.availability_rules where weekday = v_weekday;
  if not found or p_start_min < v_weekly_rule.start_min or p_end_min > v_weekly_rule.end_min or
     mod(p_start_min - v_weekly_rule.start_min, 120) <> 0 or
     exists (select 1 from public.blackout_dates where date = p_date) then
    raise exception 'Date-specific hours must fit within that weekday''s weekly hours and cannot override a blackout';
  end if;

  perform public.lock_booking_day(p_date::timestamp at time zone 'America/Vancouver');
  insert into public.availability_date_overrides (date, start_min, end_min, updated_at)
  values (p_date, p_start_min, p_end_min, now())
  on conflict (date) do update set
    start_min = excluded.start_min,
    end_min = excluded.end_min,
    updated_at = now();
end;
$$;

revoke all on function public.set_availability_date_override(date, integer, integer) from public, anon, authenticated;
grant execute on function public.set_availability_date_override(date, integer, integer) to service_role;

create or replace function public.remove_availability_date_override(p_date date)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if p_date is null then raise exception 'A date is required'; end if;
  perform public.lock_booking_day(p_date::timestamp at time zone 'America/Vancouver');
  delete from public.availability_date_overrides where date = p_date;
end;
$$;

revoke all on function public.remove_availability_date_override(date) from public, anon, authenticated;
grant execute on function public.remove_availability_date_override(date) to service_role;

-- Keep confirmation/rescheduling protected if a date override is changed after
-- the customer selected or temporarily held a slot.
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
  select * into v_override
  from public.availability_date_overrides
  where date = v_local_start::date;
  if not found then return new; end if;

  v_minute := extract(hour from v_local_start)::integer * 60 + extract(minute from v_local_start)::integer;
  v_occupied := public.booking_occupied_duration_min(new.duration_min);
  v_step := case when new.duration_min = 90 then 120 else 30 end;
  if v_minute < v_override.start_min or v_minute + v_occupied > v_override.end_min or
     mod(v_minute - v_override.start_min, v_step) <> 0 or extract(second from v_local_start) <> 0 then
    raise exception 'Booking time falls outside the date-specific availability window';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_booking_date_availability_override() from public, anon, authenticated;
drop trigger if exists bookings_date_availability_override_guard on public.bookings;
create trigger bookings_date_availability_override_guard
before insert or update of starts_at, ends_at, duration_min on public.bookings
for each row execute function public.guard_booking_date_availability_override();

-- Temporary holds use the special window for that date, falling back to the
-- normal weekday rule where no date override exists.
create or replace function public.hold_booking_slots(
  p_token_hash text,
  p_slots jsonb,
  p_expires_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_slot record;
  v_local_start timestamp;
  v_weekday integer;
  v_minute integer;
  v_rule public.availability_rules%rowtype;
  v_override public.availability_date_overrides%rowtype;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' or
     p_expires_at is null or p_expires_at <= now() or p_expires_at > now() + interval '8 minutes 15 seconds' or
     jsonb_typeof(p_slots) is distinct from 'array' or jsonb_array_length(p_slots) < 1 or jsonb_array_length(p_slots) > 200 then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_slots) s(value)
    where jsonb_typeof(s.value) <> 'object' or not (s.value ? 'startsAt') or not (s.value ? 'durationMin')
      or (s.value->>'durationMin') !~ '^[0-9]+$'
      or (s.value->>'durationMin')::integer not between 15 and 600
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_slots) with ordinality a(value, ordinality)
    join jsonb_array_elements(p_slots) with ordinality b(value, ordinality) on a.ordinality < b.ordinality
    where (a.value->>'startsAt')::timestamptz < (b.value->>'startsAt')::timestamptz + make_interval(mins => public.booking_occupied_duration_min((b.value->>'durationMin')::integer))
      and (b.value->>'startsAt')::timestamptz < (a.value->>'startsAt')::timestamptz + make_interval(mins => public.booking_occupied_duration_min((a.value->>'durationMin')::integer))
  ) then
    return jsonb_build_object('ok', false, 'error', 'conflict');
  end if;

  perform set_config('app.booking_hold_token_hash', p_token_hash, true);
  delete from public.booking_slot_holds where expires_at <= now();
  for v_slot in
    select (value->>'startsAt')::timestamptz as starts_at,
           (value->>'durationMin')::integer as duration_min
    from jsonb_array_elements(p_slots)
    order by (value->>'startsAt')::timestamptz
  loop
    perform public.lock_booking_day(v_slot.starts_at);
  end loop;

  for v_slot in
    select (value->>'startsAt')::timestamptz as starts_at,
           (value->>'durationMin')::integer as duration_min
    from jsonb_array_elements(p_slots)
    order by (value->>'startsAt')::timestamptz
  loop
    if v_slot.starts_at < now() + interval '120 minutes' or
       public.booking_overlaps(v_slot.starts_at, v_slot.starts_at + make_interval(mins => v_slot.duration_min)) then
      return jsonb_build_object('ok', false, 'error', 'conflict');
    end if;
    v_local_start := v_slot.starts_at at time zone 'America/Vancouver';
    v_weekday := extract(dow from v_local_start)::integer;
    v_minute := extract(hour from v_local_start)::integer * 60 + extract(minute from v_local_start)::integer;
    select * into v_rule from public.availability_rules where weekday = v_weekday;
    select * into v_override from public.availability_date_overrides where date = v_local_start::date;
    if found then
      v_rule.start_min := v_override.start_min;
      v_rule.end_min := v_override.end_min;
    end if;
    if v_rule.weekday is null or v_minute < v_rule.start_min or
       v_minute + public.booking_occupied_duration_min(v_slot.duration_min) > v_rule.end_min or
       mod(v_minute - v_rule.start_min, case when v_slot.duration_min = 90 then 120 else 30 end) <> 0 or
       extract(second from v_local_start) <> 0 or
       exists (select 1 from public.blackout_dates where date = v_local_start::date) then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
  end loop;

  delete from public.booking_slot_holds where hold_token_hash = p_token_hash;
  insert into public.booking_slot_holds (hold_token_hash, starts_at, duration_min, expires_at)
  select p_token_hash, (value->>'startsAt')::timestamptz, (value->>'durationMin')::integer, p_expires_at
  from jsonb_array_elements(p_slots);
  return jsonb_build_object('ok', true, 'expiresAt', p_expires_at);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'conflict');
end;
$$;

revoke all on function public.hold_booking_slots(text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.hold_booking_slots(text, jsonb, timestamptz) to service_role;
