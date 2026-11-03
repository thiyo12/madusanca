-- Record missed appointments distinctly while retaining the ability to
-- reschedule that same class for the student.
alter table public.bookings drop constraint if exists bookings_status_check;
alter table public.bookings
  add constraint bookings_status_check
  check (status in ('pending_payment', 'confirmed', 'rescheduled', 'cancelled', 'completed', 'no_show'));
