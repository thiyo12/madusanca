-- Wisdom Driving Academy — editable lesson catalogue (Phase 4)
-- Run in the Supabase SQL editor, or via `supabase db push`.
--
-- Until this migration is applied the app automatically falls back to the
-- built-in catalogue in src/lib/data/lessons.ts, and the admin lessons editor
-- shows a clear error instead of failing silently.

create table if not exists public.lessons (
  id text primary key,
  name text not null,
  duration_min integer not null check (duration_min > 0),
  price_cad numeric(10, 2) not null default 0,
  description text not null default '',
  features text[] not null default '{}',
  icon text not null default 'clock',
  popular boolean not null default false,
  category text not null default 'package' check (category in ('package', 'module')),
  updated_at timestamptz not null default now()
);

alter table public.lessons enable row level security;
-- Deny-all on purpose: only the service role reads/writes the catalogue.

-- Seed the owner-approved package catalogue (CAD prices before GST).
insert into public.lessons
  (id, name, duration_min, price_cad, description, features, icon, popular, category)
values
  ('90-minute-lesson', '90-Minute Lesson', 90, 90,
   'Private, one-on-one driving instruction with pickup and drop-off included.',
   array['One-on-one instruction', 'Pickup & drop-off included', '90 minutes per lesson'],
   'timer', false, 'package'),
  ('five-lesson-pack', '5-Lesson Pack', 90, 450,
   'Five private 90-minute lessons, with pickup and drop-off included.',
   array['Five 90-minute lessons', 'One-on-one instruction', 'Pickup & drop-off included'],
   'clock', false, 'package'),
  ('eight-lesson-pack', '8-Lesson Pack', 90, 720,
   'Eight private 90-minute lessons, with pickup and drop-off included.',
   array['Eight 90-minute lessons', 'One-on-one instruction', 'Pickup & drop-off included'],
   'timer', true, 'package'),
  ('road-test-package', 'Road Test Package', 45, 150,
   'A 45-minute mock test, car rental, and pickup one hour before your road test.',
   array['45-minute mock test', 'Car rental for the road test', 'Pickup 1 hour before the test'],
   'road-test', false, 'package')
on conflict (id) do nothing;
