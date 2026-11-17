-- Keep repeat lessons under one student profile without merging people who
-- merely share an email address. A unique normalized email + name match is
-- treated as the same student; ambiguous or email-only matches stay separate.
-- My Booking add-on purchases are already authenticated against an existing
-- booking, so their sessions follow that booking's student profile directly.
create or replace function public.ensure_student_profile_for_booking()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_student uuid;
  v_match_count integer;
  v_addon_prefix text := 'Added from My Booking ';
begin
  -- Multi-session lessons in the same package already share one profile.
  select l.student_id into v_student
  from public.student_profile_bookings l
  join public.bookings existing on existing.id = l.booking_id
  where coalesce(existing.package_id, existing.id) = coalesce(new.package_id, new.id)
  limit 1;

  -- A My Booking add-on is tied to its authenticated source booking by the
  -- server-created purchase note. Do not use email alone to connect it.
  if v_student is null and new.purchase_id is not null then
    select l.student_id into v_student
    from public.package_purchases p
    join public.bookings source
      on source.reference = substring(p.notes from char_length(v_addon_prefix) + 1)
    join public.student_profile_bookings l on l.booking_id = source.id
    where p.id = new.purchase_id
      and left(p.notes, char_length(v_addon_prefix)) = v_addon_prefix
    order by source.created_at, source.id
    limit 1;
  end if;

  -- For a separate booking, reuse a profile only when both normalized email
  -- and full name identify exactly one existing student.
  if v_student is null then
    -- Serialize first bookings for the same identity. Without this, two
    -- simultaneous inserts could both observe no profile and create duplicates.
    perform pg_advisory_xact_lock(hashtextextended(
      'student-profile:' ||
      lower(btrim(new.email)) || ':' ||
      lower(regexp_replace(btrim(new.student_name), '[[:space:]]+', ' ', 'g')),
      0
    ));

    select count(*)::integer,
      (array_agg(s.id order by s.created_at, s.id))[1]
    into v_match_count, v_student
    from public.student_profiles s
    where lower(btrim(s.email)) = lower(btrim(new.email))
      and lower(regexp_replace(btrim(s.full_name), '[[:space:]]+', ' ', 'g')) =
          lower(regexp_replace(btrim(new.student_name), '[[:space:]]+', ' ', 'g'));

    if v_match_count <> 1 then
      insert into public.student_profiles(full_name, email, phone)
      values (new.student_name, new.email, new.phone)
      returning id into v_student;
    end if;
  end if;

  insert into public.student_profile_bookings(student_id, booking_id)
  values (v_student, new.id)
  on conflict (booking_id) do nothing;

  return new;
end
$$;

revoke all on function public.ensure_student_profile_for_booking()
  from public, anon, authenticated;
