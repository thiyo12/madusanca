-- Keep sensitive identity data separate from public booking records and only
-- writable/readable by the server-side service role.
create table if not exists public.booking_student_details (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  date_of_birth date not null,
  gender text not null check (gender in ('woman', 'man', 'non_binary', 'another_identity', 'prefer_not_to_say')),
  license_number text not null check (length(btrim(license_number)) between 4 and 32),
  created_at timestamptz not null default now()
);

alter table public.booking_student_details enable row level security;
revoke all on public.booking_student_details from public, anon, authenticated;
grant select, insert, update, delete on public.booking_student_details to service_role;

create or replace function public.create_booking_bundle_with_student_details(
  p_token_hash text,
  p_token_expires_at timestamptz,
  p_packages jsonb,
  p_student_name text,
  p_email text,
  p_phone text,
  p_notes text,
  p_date_of_birth date,
  p_gender text,
  p_license_number text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_result jsonb;
  v_booking_id uuid;
begin
  if p_date_of_birth is null or p_date_of_birth > current_date or
     p_date_of_birth < (current_date - interval '120 years')::date or
     p_gender not in ('woman', 'man', 'non_binary', 'another_identity', 'prefer_not_to_say') or
     p_license_number is null or length(btrim(p_license_number)) not between 4 and 32 then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  v_result := public.create_booking_bundle(
    p_token_hash,
    p_token_expires_at,
    p_packages,
    p_student_name,
    p_email,
    p_phone,
    p_notes
  );

  if not coalesce((v_result->>'ok')::boolean, false) then
    return v_result;
  end if;

  v_booking_id := (v_result->'records'->0->>'id')::uuid;
  if v_booking_id is null then
    raise exception 'Booking bundle did not return its anchor booking';
  end if;

  insert into public.booking_student_details (booking_id, date_of_birth, gender, license_number)
  values (v_booking_id, p_date_of_birth, p_gender, btrim(p_license_number));

  return v_result;
end;
$$;

revoke all on function public.create_booking_bundle_with_student_details(
  text, timestamptz, jsonb, text, text, text, text, date, text, text
) from public, anon, authenticated;
grant execute on function public.create_booking_bundle_with_student_details(
  text, timestamptz, jsonb, text, text, text, text, date, text, text
) to service_role;
