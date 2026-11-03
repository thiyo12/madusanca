-- Temporary all-or-nothing holds while a customer reviews and confirms a
-- complete multi-session booking. Only the hash of the browser hold token is
-- persisted; abandoned holds stop blocking availability after eight minutes.
create table public.booking_slot_holds (
  hold_token_hash text not null check (hold_token_hash ~ '^[a-f0-9]{64}$'),
  starts_at timestamptz not null,
  duration_min integer not null check (duration_min between 15 and 600),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (hold_token_hash, starts_at)
);

create index booking_slot_holds_active_start_idx
  on public.booking_slot_holds (starts_at, expires_at);

alter table public.booking_slot_holds enable row level security;
revoke all on public.booking_slot_holds from public, anon, authenticated;
grant select, insert, delete on public.booking_slot_holds to service_role;

-- Make every existing booking writer respect active temporary holds. The
-- finalization wrapper sets a transaction-local token hash so it ignores only
-- the holds being converted into that customer's booking.
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
  ) or exists (
    select 1
    from public.booking_slot_holds h cross join candidate c
    where h.expires_at > now()
      and h.hold_token_hash is distinct from nullif(current_setting('app.booking_hold_token_hash', true), '')
      and h.starts_at < c.ends_at
      and p_starts_at < h.starts_at + make_interval(mins => public.booking_occupied_duration_min(h.duration_min))
  );
$$;

revoke all on function public.booking_overlaps(timestamptz, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.booking_overlaps(timestamptz, timestamptz, uuid) to service_role;

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
    if not found or v_minute < v_rule.start_min or
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

create or replace function public.release_booking_slots(p_token_hash text)
returns void
language sql
security definer
set search_path = pg_catalog
as $$
  delete from public.booking_slot_holds where hold_token_hash = p_token_hash;
$$;

revoke all on function public.release_booking_slots(text) from public, anon, authenticated;
grant execute on function public.release_booking_slots(text) to service_role;

-- Finalization requires an active hold that exactly covers every selected
-- session; the hold is consumed only after the booking bundle succeeds.
create or replace function public.create_booking_bundle_with_student_details(
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
declare
  v_result jsonb;
  v_booking_id uuid;
  v_expected integer;
begin
  if p_date_of_birth is null or p_date_of_birth > current_date or
     p_date_of_birth < (current_date - interval '120 years')::date or
     p_gender not in ('woman', 'man', 'non_binary', 'another_identity', 'prefer_not_to_say') or
     p_license_number is null or length(btrim(p_license_number)) not between 4 and 32 then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if p_hold_token_hash is null or p_hold_token_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'error', 'conflict');
  end if;
  select count(*)::integer into v_expected
  from jsonb_array_elements(p_packages) e(value)
  cross join lateral jsonb_array_elements_text(e.value->'startsAt') s(value)
  join public.lessons l on l.id = e.value->>'lessonId';
  if v_expected < 1 or v_expected <> (
    select count(*) from public.booking_slot_holds h
    where h.hold_token_hash = p_hold_token_hash and h.expires_at > now()
  ) or exists (
    select 1
    from jsonb_array_elements(p_packages) e(value)
    cross join lateral jsonb_array_elements_text(e.value->'startsAt') s(value)
    join public.lessons l on l.id = e.value->>'lessonId'
    left join public.booking_slot_holds h
      on h.hold_token_hash = p_hold_token_hash
      and h.starts_at = s.value::timestamptz
      and h.duration_min = l.duration_min
      and h.expires_at > now()
    where h.hold_token_hash is null
  ) then
    return jsonb_build_object('ok', false, 'error', 'conflict');
  end if;

  perform set_config('app.booking_hold_token_hash', p_hold_token_hash, true);
  v_result := public.create_booking_bundle(
    p_token_hash, p_token_expires_at, p_packages,
    p_student_name, p_email, p_phone, p_notes
  );
  if not coalesce((v_result->>'ok')::boolean, false) then
    return v_result;
  end if;

  v_booking_id := (v_result->'records'->0->>'id')::uuid;
  if v_booking_id is null then
    raise exception 'Booking bundle did not return its anchor booking';
  end if;
  insert into public.booking_student_details (booking_id, date_of_birth, gender, license_number)
  values (v_booking_id, p_date_of_birth, p_gender, btrim(p_license_number));
  delete from public.booking_slot_holds where hold_token_hash = p_hold_token_hash;
  return v_result;
end;
$$;

revoke all on function public.create_booking_bundle_with_student_details(text, timestamptz, jsonb, text, text, text, text, date, text, text, text) from public, anon, authenticated;
grant execute on function public.create_booking_bundle_with_student_details(text, timestamptz, jsonb, text, text, text, text, date, text, text, text) to service_role;
