-- Migration 0045 raised the quota function to 15 sends, but the table's
-- original CHECK constraint still capped send_count at 3 and rejected the
-- fourth eligible request. Keep the stored counter aligned with the quota.
alter table public.booking_otp_send_limits
  drop constraint if exists booking_otp_send_limits_send_count_check;

alter table public.booking_otp_send_limits
  add constraint booking_otp_send_limits_send_count_check
  check (send_count between 0 and 15);
