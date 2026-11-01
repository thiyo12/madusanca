-- Make the number of separately scheduled lessons a structured, admin-editable
-- property of a catalogue package. Existing records default to one session.
alter table public.lessons
  add column if not exists session_count integer not null default 1;

alter table public.lessons
  drop constraint if exists lessons_session_count_check;
alter table public.lessons
  add constraint lessons_session_count_check
  check (session_count between 1 and 20);

update public.lessons set session_count = 5 where id = 'five-lesson-pack' and session_count = 1;
update public.lessons set session_count = 8 where id = 'eight-lesson-pack' and session_count = 1;
