-- Admin calendar bookings may use custom times. Student-facing booking rules
-- remain enforced; this transaction-local flag is only set by service-role RPCs.
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
  if current_setting('app.admin_calendar_override', true) = 'on' then return new; end if;
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
  if v_rule.weekday is null or v_minute < v_start_min or
     v_minute + public.booking_occupied_duration_min(new.duration_min) > v_end_min or
     mod(v_minute - v_start_min, public.booking_start_cadence_min(new.duration_min)) <> 0 or
     extract(second from v_local_start) <> 0 then
    raise exception 'Package booking must use a valid appointment start time';
  end if;
  return new;
end;
$$;

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
grant execute on function public.guard_booking_occupied_slot() to service_role;

create or replace function public.admin_create_calendar_booking(
  p_token_hash text,
  p_token_expires_at timestamptz,
  p_lesson_id text,
  p_starts_at timestamptz,
  p_student_name text,
  p_email text,
  p_phone text,
  p_notes text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_lesson public.lessons%rowtype;
  v_booking public.bookings%rowtype;
  v_ends_at timestamptz;
begin
  if p_token_hash is null or length(p_token_hash) < 32 or p_token_expires_at <= now() or
     p_starts_at <= now() or length(btrim(p_student_name)) < 2 or length(btrim(p_email)) < 3 then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select * into v_lesson from public.lessons where id = p_lesson_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  v_ends_at := p_starts_at + make_interval(mins => v_lesson.duration_min);
  perform public.lock_booking_day(p_starts_at);
  perform public.lock_booking_day(p_starts_at + interval '1 day');
  if public.booking_overlaps(p_starts_at, v_ends_at) then
    return jsonb_build_object('ok', false, 'error', 'conflict');
  end if;
  perform set_config('app.admin_calendar_override', 'on', true);
  insert into public.bookings (
    reference, lesson_id, lesson_name, duration_min, price_cad, starts_at, ends_at,
    student_name, email, phone, notes, status, payment_status, session_index, session_count,
    package_price_cad, package_window_start
  ) values (
    public.new_reference(), v_lesson.id, v_lesson.name, v_lesson.duration_min, v_lesson.price_cad,
    p_starts_at, v_ends_at, btrim(p_student_name), lower(btrim(p_email)), btrim(p_phone), coalesce(p_notes, ''),
    'confirmed', 'due', 1, 1, v_lesson.price_cad, (p_starts_at at time zone 'America/Vancouver')::date
  ) returning * into v_booking;
  insert into public.booking_tokens(token_hash, booking_id, expires_at)
    values (p_token_hash, v_booking.id, p_token_expires_at);
  return jsonb_build_object('ok', true, 'record', to_jsonb(v_booking));
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'conflict');
end;
$$;
revoke all on function public.admin_create_calendar_booking(text, timestamptz, text, timestamptz, text, text, text, text) from public, anon, authenticated;
grant execute on function public.admin_create_calendar_booking(text, timestamptz, text, timestamptz, text, text, text, text) to service_role;

create or replace function public.admin_reschedule_package_session(
  p_booking_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_new_token_hash text,
  p_new_token_expires_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_target public.bookings%rowtype;
  v_anchor_id uuid;
begin
  select * into v_target from public.bookings where id = p_booking_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if v_target.status in ('cancelled', 'completed') then
    return jsonb_build_object('ok', false, 'error', 'not_modifiable');
  end if;
  if p_starts_at <= now() or p_ends_at <= p_starts_at or
     p_ends_at - p_starts_at <> make_interval(mins => v_target.duration_min) or
     extract(second from (p_starts_at at time zone 'America/Vancouver')) <> 0 then
    return jsonb_build_object('ok', false, 'error', 'not_modifiable');
  end if;
  perform public.lock_booking_day(p_starts_at);
  perform public.lock_booking_day(p_starts_at + interval '1 day');
  if public.booking_overlaps(p_starts_at, p_ends_at, v_target.id) then
    return jsonb_build_object('ok', false, 'error', 'conflict');
  end if;
  perform set_config('app.admin_calendar_override', 'on', true);
  update public.bookings set starts_at = p_starts_at, ends_at = p_ends_at,
    status = 'rescheduled', updated_at = now()
  where id = v_target.id returning * into v_target;
  select id into v_anchor_id from public.bookings
    where package_id = v_target.package_id and session_index = 1;
  if v_anchor_id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  delete from public.booking_tokens where booking_id in (
    select id from public.bookings where package_id = v_target.package_id
  );
  insert into public.booking_tokens(token_hash, booking_id, expires_at)
    values (p_new_token_hash, v_anchor_id, p_new_token_expires_at);
  return jsonb_build_object('ok', true, 'record', to_jsonb(v_target));
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'conflict');
end;
$$;
revoke all on function public.admin_reschedule_package_session(uuid, timestamptz, timestamptz, text, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_reschedule_package_session(uuid, timestamptz, timestamptz, text, timestamptz) to service_role;
