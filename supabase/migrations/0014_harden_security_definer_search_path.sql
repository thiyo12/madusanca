-- SECURITY DEFINER functions must not resolve attacker-controlled objects from
-- writable schemas. Application relations/functions and extensions are already
-- schema-qualified in these bodies; keep implicit lookup limited to pg_catalog.
alter function public.create_booking(
  text, timestamptz, text, text, integer, numeric,
  timestamptz, timestamptz, text, text, text, text
) set search_path = pg_catalog;

alter function public.get_booking_by_token(text)
  set search_path = pg_catalog;
alter function public.reschedule_booking_by_token(
  text, timestamptz, timestamptz, text, timestamptz
) set search_path = pg_catalog;
alter function public.cancel_booking_by_token(text)
  set search_path = pg_catalog;

alter function public.consume_booking_otp_send_quota(text, timestamptz)
  set search_path = pg_catalog;
alter function public.reschedule_student_booking_by_token(
  text, timestamptz, timestamptz, text, timestamptz
) set search_path = pg_catalog;

alter function public.record_stripe_checkout_event(
  text, text, uuid, text, text, text, text, bigint, bigint, bigint, text
) set search_path = pg_catalog;
alter function public.record_stripe_upgrade_checkout_event(
  text, text, uuid, text, text, text, text, bigint, bigint, bigint,
  text, text, text, integer, numeric, numeric
) set search_path = pg_catalog;

alter function public.verify_booking_otp(text, text, boolean)
  set search_path = pg_catalog;
alter function public.consume_rate_limit(text, integer, integer)
  set search_path = pg_catalog;
