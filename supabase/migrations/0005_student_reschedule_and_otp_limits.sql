-- Student self-service limits: max two student-initiated reschedules per
-- booking, 3 OTP sends per email per 24 hours, and a 2-minute resend cooldown.

alter table public.bookings
  add column if not exists student_reschedule_count integer not null default 0
  check (student_reschedule_count between 0 and 2);

create table if not exists public.booking_otp_send_limits (
  email text primary key,
  window_started_at timestamptz not null,
  last_sent_at timestamptz not null,
  send_count integer not null default 0 check (send_count between 0 and 3)
);

alter table public.booking_otp_send_limits enable row level security;
-- No policies: access is server-side only with the service-role key.

create or replace function public.consume_booking_otp_send_quota(
  p_email text,
  p_now timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_limit public.booking_otp_send_limits;
  v_retry_seconds integer;
begin
  -- Serialize requests for the same address, including the first insert.
  perform pg_advisory_xact_lock(hashtext('booking-otp:' || v_email));

  select * into v_limit
  from public.booking_otp_send_limits
  where email = v_email
  for update;

  if not found or v_limit.window_started_at <= p_now - interval '24 hours' then
    insert into public.booking_otp_send_limits
      (email, window_started_at, last_sent_at, send_count)
    values (v_email, p_now, p_now, 1)
    on conflict (email) do update set
      window_started_at = excluded.window_started_at,
      last_sent_at = excluded.last_sent_at,
      send_count = 1;
    return jsonb_build_object('allowed', true);
  end if;

  if v_limit.send_count >= 3 then
    v_retry_seconds := greatest(1, ceil(extract(epoch from
      (v_limit.window_started_at + interval '24 hours' - p_now)))::integer);
    return jsonb_build_object(
      'allowed', false,
      'reason', 'daily_limit',
      'retry_after_seconds', v_retry_seconds
    );
  end if;

  if v_limit.last_sent_at > p_now - interval '2 minutes' then
    v_retry_seconds := greatest(1, ceil(extract(epoch from
      (v_limit.last_sent_at + interval '2 minutes' - p_now)))::integer);
    return jsonb_build_object(
      'allowed', false,
      'reason', 'cooldown',
      'retry_after_seconds', v_retry_seconds
    );
  end if;

  update public.booking_otp_send_limits
  set last_sent_at = p_now,
      send_count = send_count + 1
  where email = v_email;

  return jsonb_build_object('allowed', true);
end;
$$;

create or replace function public.reschedule_student_booking_by_token(
  p_token_hash text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_new_token_hash text,
  p_new_token_expires_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings;
begin
  select b.* into v_booking
  from public.booking_tokens t
  join public.bookings b on b.id = t.booking_id
  where t.token_hash = p_token_hash
    and t.expires_at > now()
  for update of b;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;
  if v_booking.status in ('cancelled', 'completed') then
    return jsonb_build_object('ok', false, 'error', 'not_modifiable');
  end if;
  if v_booking.student_reschedule_count >= 2 then
    return jsonb_build_object('ok', false, 'error', 'reschedule_limit');
  end if;

  perform public.lock_booking_day(p_starts_at);
  if public.booking_overlaps(p_starts_at, p_ends_at, v_booking.id) then
    return jsonb_build_object('ok', false, 'error', 'conflict');
  end if;

  update public.bookings
  set starts_at = p_starts_at,
      ends_at = p_ends_at,
      status = 'rescheduled',
      student_reschedule_count = student_reschedule_count + 1,
      updated_at = now()
  where id = v_booking.id
  returning * into v_booking;

  delete from public.booking_tokens where booking_id = v_booking.id;
  insert into public.booking_tokens (token_hash, booking_id, expires_at)
  values (p_new_token_hash, v_booking.id, p_new_token_expires_at);

  return jsonb_build_object('ok', true, 'record', to_jsonb(v_booking));
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'conflict');
end;
$$;

revoke execute on function public.consume_booking_otp_send_quota(text, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.reschedule_student_booking_by_token(
  text, timestamptz, timestamptz, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.consume_booking_otp_send_quota(text, timestamptz)
  to service_role;
grant execute on function public.reschedule_student_booking_by_token(
  text, timestamptz, timestamptz, text, timestamptz
) to service_role;
