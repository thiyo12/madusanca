-- Road-test packages have a 45-minute lesson but reserve a 90-minute schedule
-- block. Regular 90-minute lessons continue to reserve 120 minutes.
create or replace function public.booking_occupied_duration_min(p_duration_min integer)
returns integer
language sql
immutable
set search_path = pg_catalog
as $$
  select case when p_duration_min = 45 then 90
              when p_duration_min = 90 then 120
              else p_duration_min end;
$$;

create or replace function public.booking_start_cadence_min(p_duration_min integer)
returns integer
language sql
immutable
set search_path = pg_catalog
as $$
  select case when p_duration_min = 45 then 90
              when p_duration_min = 90 then 120
              else 30 end;
$$;

revoke all on function public.booking_occupied_duration_min(integer) from public, anon, authenticated;
grant execute on function public.booking_occupied_duration_min(integer) to service_role;
revoke all on function public.booking_start_cadence_min(integer) from public, anon, authenticated;
grant execute on function public.booking_start_cadence_min(integer) to service_role;

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
begin
  v_local_start := new.starts_at at time zone 'America/Vancouver';
  select * into v_override from public.availability_date_overrides where date = v_local_start::date;
  if not found then return new; end if;
  v_minute := extract(hour from v_local_start)::integer * 60 + extract(minute from v_local_start)::integer;
  v_occupied := public.booking_occupied_duration_min(new.duration_min);
  if v_minute < v_override.start_min or v_minute + v_occupied > v_override.end_min or
     mod(v_minute - v_override.start_min, public.booking_start_cadence_min(new.duration_min)) <> 0 or
     extract(second from v_local_start) <> 0 then
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
     mod(v_minute - v_start_min, public.booking_start_cadence_min(new.duration_min)) <> 0 or
     extract(second from v_local_start) <> 0 then
    raise exception 'Package booking must use a valid appointment start time';
  end if;
  return new;
end;
$$;

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
     mod(v_minute - v_start_min, public.booking_start_cadence_min(new.duration_min)) <> 0 or
     extract(second from v_local_start) <> 0 then
    raise exception 'Package hold must use a valid appointment start time';
  end if;
  return new;
end;
$$;

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
  if not found or v_booking.payment_status <> 'due' or v_booking.status in ('cancelled', 'completed') then
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
         mod(v_minute - coalesce(v_override.start_min, v_rule.start_min), public.booking_start_cadence_min(v_session.duration_min)) <> 0 or
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
