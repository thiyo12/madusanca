alter table public.student_profiles
  add column first_name text not null default '',
  add column last_name text not null default '',
  add column license_class text not null default '',
  add column street text not null default '',
  add column city text not null default '',
  add column province text not null default 'BC',
  add column postal_code text not null default '';

create or replace function public.admin_update_student_profile(
  p_student_id uuid,
  p_admin_id uuid,
  p_full_name text,
  p_email text,
  p_phone text,
  p_date_of_birth date,
  p_gender text,
  p_license_number text,
  p_first_name text,
  p_last_name text,
  p_license_class text,
  p_street text,
  p_city text,
  p_province text,
  p_postal_code text
) returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_fields text[] := '{}';
  v_old public.student_profiles%rowtype;
begin
  if p_full_name is null or length(btrim(p_full_name)) not between 1 and 160 or
     p_email is null or length(btrim(p_email)) > 160 or p_phone is null or length(p_phone) > 25 or
     (p_gender is not null and p_gender not in ('woman','man','non_binary','another_identity','prefer_not_to_say')) or
     (p_license_number is not null and length(btrim(p_license_number)) not between 4 and 32) or
     p_first_name is null or length(btrim(p_first_name)) > 30 or
     p_last_name is null or length(btrim(p_last_name)) > 30 or
     p_license_class is null or p_license_class not in ('','7L','7N','5','Other') or
     p_street is null or length(p_street) > 120 or p_city is null or length(p_city) > 60 or
     p_province is distinct from 'BC' or p_postal_code is null or length(p_postal_code) > 12 then
    raise exception 'invalid student details';
  end if;

  select * into v_old from public.student_profiles where id = p_student_id for update;
  if not found then raise exception 'student not found'; end if;
  if v_old.full_name is distinct from btrim(p_full_name) then v_fields := array_append(v_fields,'full_name'); end if;
  if v_old.email is distinct from btrim(p_email) then v_fields := array_append(v_fields,'email'); end if;
  if v_old.phone is distinct from btrim(p_phone) then v_fields := array_append(v_fields,'phone'); end if;
  if v_old.date_of_birth is distinct from p_date_of_birth then v_fields := array_append(v_fields,'date_of_birth'); end if;
  if v_old.gender is distinct from p_gender then v_fields := array_append(v_fields,'gender'); end if;
  if v_old.license_number is distinct from nullif(btrim(p_license_number),'') then v_fields := array_append(v_fields,'license_number'); end if;
  if v_old.first_name is distinct from btrim(p_first_name) then v_fields := array_append(v_fields,'first_name'); end if;
  if v_old.last_name is distinct from btrim(p_last_name) then v_fields := array_append(v_fields,'last_name'); end if;
  if v_old.license_class is distinct from p_license_class then v_fields := array_append(v_fields,'license_class'); end if;
  if v_old.street is distinct from btrim(p_street) then v_fields := array_append(v_fields,'street'); end if;
  if v_old.city is distinct from btrim(p_city) then v_fields := array_append(v_fields,'city'); end if;
  if v_old.province is distinct from p_province then v_fields := array_append(v_fields,'province'); end if;
  if v_old.postal_code is distinct from btrim(p_postal_code) then v_fields := array_append(v_fields,'postal_code'); end if;

  update public.student_profiles set
    full_name = btrim(p_full_name), email = btrim(p_email), phone = btrim(p_phone),
    date_of_birth = p_date_of_birth, gender = p_gender, license_number = nullif(btrim(p_license_number),''),
    first_name = btrim(p_first_name), last_name = btrim(p_last_name), license_class = p_license_class,
    street = btrim(p_street), city = btrim(p_city), province = p_province,
    postal_code = btrim(p_postal_code), updated_at = now()
  where id = p_student_id;

  update public.bookings b set student_name = btrim(p_full_name), email = btrim(p_email), phone = btrim(p_phone), updated_at = now()
    where b.id in (select l.booking_id from public.student_profile_bookings l where l.student_id = p_student_id);
  update public.booking_student_details d set date_of_birth = p_date_of_birth, gender = p_gender,
    license_number = nullif(btrim(p_license_number),'')
    where d.booking_id in (select l.booking_id from public.student_profile_bookings l where l.student_id = p_student_id)
      and p_date_of_birth is not null and p_gender is not null and p_license_number is not null;
  if cardinality(v_fields) > 0 then
    insert into public.student_profile_audit(student_id, admin_id, action, changed_fields)
      values (p_student_id, p_admin_id, 'details_updated', v_fields);
  end if;
end;
$$;

revoke all on function public.admin_update_student_profile(uuid,uuid,text,text,text,date,text,text,text,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.admin_update_student_profile(uuid,uuid,text,text,text,date,text,text,text,text,text,text,text,text,text) to service_role;
