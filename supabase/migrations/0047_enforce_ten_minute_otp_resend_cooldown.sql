-- Reassert the server-side OTP cooldown in the latest quota function. The
-- database timestamp is authoritative so browser storage/state cannot bypass it.
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

  if v_limit.last_sent_at > p_now - interval '10 minutes' then
    v_retry_seconds := greatest(1, ceil(extract(epoch from
      (v_limit.last_sent_at + interval '10 minutes' - p_now)))::integer);
    return jsonb_build_object(
      'allowed', false,
      'reason', 'cooldown',
      'retry_after_seconds', v_retry_seconds
    );
  end if;

  if v_limit.send_count >= 15 then
    v_retry_seconds := greatest(1, ceil(extract(epoch from
      (v_limit.window_started_at + interval '24 hours' - p_now)))::integer);
    return jsonb_build_object(
      'allowed', false,
      'reason', 'daily_limit',
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

revoke all on function public.consume_booking_otp_send_quota(text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.consume_booking_otp_send_quota(text, timestamptz)
  to service_role;
