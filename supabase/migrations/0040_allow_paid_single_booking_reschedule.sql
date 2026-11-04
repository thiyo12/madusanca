-- A paid single lesson remains eligible for its one self-service reschedule.
-- The API still enforces the 48-hour cutoff and the RPC enforces the per-lesson
-- reschedule count, schedule validity, and token ownership.
create or replace function public.reschedule_package_session_by_token(
  p_token_hash text,
  p_session_id uuid,
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
  v_anchor public.bookings%rowtype;
  v_target public.bookings%rowtype;
  v_manage_anchor_id uuid;
  v_start_local timestamp;
  v_minute integer;
  v_rule public.availability_rules%rowtype;
begin
  select b.* into v_anchor
  from public.booking_tokens t join public.bookings b on b.id = t.booking_id
  where t.token_hash = p_token_hash and t.expires_at > now()
  for update of b;
  if not found then return jsonb_build_object('ok', false, 'error', 'expired'); end if;

  select * into v_target from public.bookings
  where id = p_session_id and package_id = v_anchor.package_id
  for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select id into v_manage_anchor_id from public.bookings
  where package_id = v_anchor.package_id and session_index = 1;
  if v_manage_anchor_id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if v_target.status in ('cancelled', 'completed') or v_target.starts_at < now() + interval '48 hours' then
    return jsonb_build_object('ok', false, 'error', 'not_modifiable');
  end if;
  if v_target.student_reschedule_count >= 1 then
    return jsonb_build_object('ok', false, 'error', 'reschedule_limit');
  end if;
  if p_starts_at < now() + interval '120 minutes' or p_ends_at <= p_starts_at or
     p_ends_at - p_starts_at <> make_interval(mins => v_target.duration_min) or
     (p_starts_at at time zone 'America/Vancouver')::date < v_target.package_window_start or
     (p_starts_at at time zone 'America/Vancouver')::date > v_target.package_window_start + interval '2 months' then
    return jsonb_build_object('ok', false, 'error', 'not_modifiable');
  end if;

  perform public.lock_booking_day(p_starts_at);
  if public.booking_overlaps(p_starts_at, p_ends_at, v_target.id) then
    return jsonb_build_object('ok', false, 'error', 'conflict');
  end if;
  v_start_local := p_starts_at at time zone 'America/Vancouver';
  v_minute := extract(hour from v_start_local)::integer * 60 + extract(minute from v_start_local)::integer;
  select * into v_rule from public.availability_rules where weekday = extract(dow from v_start_local)::integer;
  if not found or v_minute < v_rule.start_min or v_minute + v_target.duration_min > v_rule.end_min or
     v_minute % 30 <> 0 or extract(second from v_start_local) <> 0 or
     exists (select 1 from public.blackout_dates where date = v_start_local::date) then
    return jsonb_build_object('ok', false, 'error', 'not_modifiable');
  end if;

  update public.bookings set starts_at = p_starts_at, ends_at = p_ends_at,
    status = 'rescheduled', student_reschedule_count = student_reschedule_count + 1,
    updated_at = now()
  where id = v_target.id returning * into v_target;
  delete from public.booking_tokens where booking_id in (
    select id from public.bookings where package_id = v_anchor.package_id
  );
  insert into public.booking_tokens (token_hash, booking_id, expires_at)
  values (p_new_token_hash, v_manage_anchor_id, p_new_token_expires_at);
  return jsonb_build_object('ok', true, 'record', to_jsonb(v_target));
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'conflict');
end;
$$;
revoke execute on function public.reschedule_package_session_by_token(text, uuid, timestamptz, timestamptz, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.reschedule_package_session_by_token(text, uuid, timestamptz, timestamptz, text, timestamptz)
  to service_role;
