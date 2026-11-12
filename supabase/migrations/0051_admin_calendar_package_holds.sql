-- Admin-created package bookings may use the date/time selected directly in
-- the calendar, including custom starts and times less than two hours away.
-- Keep the student-facing hold RPC and its availability rules unchanged.

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
     mod(v_minute - v_start_min, 120) <> 0 or extract(second from v_local_start) <> 0 then
    raise exception 'Package holds must use a valid two-hour appointment start';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_booking_slot_hold_cadence() from public, anon, authenticated;

create or replace function public.admin_hold_booking_slots(
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
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' or p_expires_at is null or
     p_expires_at <= now() or p_expires_at > now() + interval '20 minutes 15 seconds' or
     jsonb_typeof(p_slots) is distinct from 'array' or jsonb_array_length(p_slots) < 1 or
     jsonb_array_length(p_slots) > 200 then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_slots) s(value)
    where jsonb_typeof(s.value) <> 'object' or not (s.value ? 'startsAt') or not (s.value ? 'durationMin') or
      (s.value->>'durationMin') !~ '^[0-9]+$' or (s.value->>'durationMin')::integer not between 15 and 600 or
      not (s.value->>'startsAt') ~ '^\d{4}-\d{2}-\d{2}T'
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_slots) with ordinality a(value, ord)
    join jsonb_array_elements(p_slots) with ordinality b(value, ord) on a.ord < b.ord
    where (a.value->>'startsAt')::timestamptz < (b.value->>'startsAt')::timestamptz +
        make_interval(mins => public.booking_occupied_duration_min((b.value->>'durationMin')::integer))
      and (b.value->>'startsAt')::timestamptz < (a.value->>'startsAt')::timestamptz +
        make_interval(mins => public.booking_occupied_duration_min((a.value->>'durationMin')::integer))
  ) then
    return jsonb_build_object('ok', false, 'error', 'conflict');
  end if;

  perform set_config('app.admin_calendar_override', 'on', true);
  perform set_config('app.booking_hold_token_hash', p_token_hash, true);
  delete from public.booking_slot_holds where expires_at <= now();
  for v_slot in
    select (value->>'startsAt')::timestamptz as starts_at
    from jsonb_array_elements(p_slots) order by 1
  loop
    if v_slot.starts_at <= now() then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    perform public.lock_booking_day(v_slot.starts_at);
    perform public.lock_booking_day(v_slot.starts_at + interval '1 day');
  end loop;
  for v_slot in
    select (value->>'startsAt')::timestamptz as starts_at,
           (value->>'durationMin')::integer as duration_min
    from jsonb_array_elements(p_slots) order by 1
  loop
    if public.booking_overlaps(
      v_slot.starts_at,
      v_slot.starts_at + make_interval(mins => v_slot.duration_min)
    ) then
      return jsonb_build_object('ok', false, 'error', 'conflict');
    end if;
  end loop;
  delete from public.booking_slot_holds where hold_token_hash = p_token_hash;
  insert into public.booking_slot_holds(hold_token_hash, starts_at, duration_min, expires_at)
    select p_token_hash, (value->>'startsAt')::timestamptz,
           (value->>'durationMin')::integer, p_expires_at
    from jsonb_array_elements(p_slots);
  return jsonb_build_object('ok', true, 'expiresAt', p_expires_at);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'conflict');
end;
$$;
revoke all on function public.admin_hold_booking_slots(text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_hold_booking_slots(text, jsonb, timestamptz) to service_role;

-- Allow the existing bundle routine to honor the admin override, while still
-- enforcing future dates, package windows, exact active holds, and conflicts.
do $$
declare
  v_definition text;
  v_before text;
begin
  select pg_get_functiondef(
    'public.create_booking_bundle(text,timestamptz,jsonb,text,text,text,text)'::regprocedure
  ) into v_definition;

  v_before := v_definition;
  v_definition := replace(v_definition,
    'v_anchor_start < now() + interval ''120 minutes''',
    '(case when current_setting(''app.admin_calendar_override'', true) = ''on'' then v_anchor_start <= now() else v_anchor_start < now() + interval ''120 minutes'' end)');
  v_definition := replace(v_definition,
    '(v_anchor_start at time zone ''America/Vancouver'')::date > ((now() at time zone ''America/Vancouver'')::date + interval ''6 months'')::date',
    '(current_setting(''app.admin_calendar_override'', true) is distinct from ''on'' and (v_anchor_start at time zone ''America/Vancouver'')::date > ((now() at time zone ''America/Vancouver'')::date + interval ''6 months'')::date)');
  v_definition := replace(v_definition,
    E'if exists (\n    select 1\n    from jsonb_array_elements(p_packages) e(value)\n    join public.lessons l on l.id = e.value->>''lessonId''\n    cross join lateral jsonb_array_elements_text(e.value->''startsAt'') s(value)\n    join public.availability_rules r on r.weekday = extract(dow from (s.value::timestamptz at time zone ''America/Vancouver''))::integer',
    E'if current_setting(''app.admin_calendar_override'', true) is distinct from ''on'' and exists (\n    select 1\n    from jsonb_array_elements(p_packages) e(value)\n    join public.lessons l on l.id = e.value->>''lessonId''\n    cross join lateral jsonb_array_elements_text(e.value->''startsAt'') s(value)\n    join public.availability_rules r on r.weekday = extract(dow from (s.value::timestamptz at time zone ''America/Vancouver''))::integer');
  v_definition := replace(v_definition,
    'if not found or v_minute < v_rule.start_min or v_minute + public.booking_occupied_duration_min(v_lesson.duration_min) > v_rule.end_min or',
    'if current_setting(''app.admin_calendar_override'', true) is distinct from ''on'' and (not found or v_minute < v_rule.start_min or v_minute + public.booking_occupied_duration_min(v_lesson.duration_min) > v_rule.end_min or');
  v_definition := replace(v_definition,
    'exists (select 1 from public.blackout_dates where date = v_local_start::date) then',
    'exists (select 1 from public.blackout_dates where date = v_local_start::date)) then');
  if v_definition = v_before or
     position('app.admin_calendar_override' in v_definition) = 0 or
     position('current_setting(''app.admin_calendar_override'', true) is distinct from ''on'' and exists' in v_definition) = 0 then
    raise exception 'Could not safely update create_booking_bundle for admin calendar overrides';
  end if;
  execute v_definition;
end;
$$;

create or replace function public.admin_create_booking_bundle_with_student_details(
  p_token_hash text,
  p_token_expires_at timestamptz,
  p_packages jsonb,
  p_student_name text,
  p_email text,
  p_phone text,
  p_notes text,
  p_date_of_birth date,
  p_gender text,
  p_license_number text,
  p_hold_token_hash text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform set_config('app.admin_calendar_override', 'on', true);
  return public.create_booking_bundle_with_student_details(
    p_token_hash, p_token_expires_at, p_packages, p_student_name, p_email,
    p_phone, p_notes, p_date_of_birth, p_gender, p_license_number, p_hold_token_hash
  );
end;
$$;
revoke all on function public.admin_create_booking_bundle_with_student_details(text, timestamptz, jsonb, text, text, text, text, date, text, text, text) from public, anon, authenticated;
grant execute on function public.admin_create_booking_bundle_with_student_details(text, timestamptz, jsonb, text, text, text, text, date, text, text, text) to service_role;
