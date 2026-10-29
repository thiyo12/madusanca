-- Update existing seeded catalogue rows to the owner-approved packages.
-- Safe to run after 0002; it preserves unrelated lessons the owner added.
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
on conflict (id) do update set
  name = excluded.name,
  duration_min = excluded.duration_min,
  price_cad = excluded.price_cad,
  description = excluded.description,
  features = excluded.features,
  icon = excluded.icon,
  popular = excluded.popular,
  category = excluded.category,
  updated_at = now();

-- Remove only the former built-in demo offerings, not owner-created lessons.
delete from public.lessons
where id in ('60-minute-lesson', 'highway-confidence', 'night-driving', 'winter-driving');
