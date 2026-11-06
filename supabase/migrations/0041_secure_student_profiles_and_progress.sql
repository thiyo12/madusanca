-- Admin-managed profiles. Existing package sessions are grouped only by their
-- package UUID, never by email; administrators may link other bookings later.
create table public.student_profiles (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(btrim(full_name)) between 1 and 160),
  email text not null,
  phone text not null default '',
  date_of_birth date,
  gender text,
  license_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.student_profile_bookings (
  student_id uuid not null references public.student_profiles(id) on delete cascade,
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  linked_at timestamptz not null default now(),
  primary key (student_id, booking_id)
);
create table public.student_profile_audit (
  id bigint generated always as identity primary key,
  student_id uuid not null references public.student_profiles(id) on delete cascade,
  admin_id uuid not null,
  action text not null check (action in ('created','details_updated','booking_linked','assessment_created')),
  changed_fields text[] not null default '{}',
  created_at timestamptz not null default now()
);
create table public.student_assessments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.student_profiles(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete set null,
  assessment_date date not null default current_date,
  vehicle_control smallint check (vehicle_control between 1 and 5),
  observation smallint check (observation between 1 and 5),
  intersections smallint check (intersections between 1 and 5),
  lane_changes smallint check (lane_changes between 1 and 5),
  speed_space smallint check (speed_space between 1 and 5),
  parking smallint check (parking between 1 and 5),
  hazard_awareness smallint check (hazard_awareness between 1 and 5),
  road_test_date date,
  road_test_location text,
  road_test_outcome text check (road_test_outcome in ('passed','not_passed','not_taken')),
  notes text not null default '' check (length(notes) <= 4000),
  admin_id uuid not null,
  created_at timestamptz not null default now()
);
create index student_profiles_license_idx on public.student_profiles (license_number);
create index student_assessments_student_date_idx on public.student_assessments (student_id, assessment_date desc);
alter table public.student_profiles enable row level security;
alter table public.student_profile_bookings enable row level security;
alter table public.student_profile_audit enable row level security;
alter table public.student_assessments enable row level security;
revoke all on public.student_profiles, public.student_profile_bookings, public.student_profile_audit, public.student_assessments from public, anon, authenticated;
grant select, insert, update, delete on public.student_profiles, public.student_profile_bookings, public.student_profile_audit, public.student_assessments to service_role;
grant usage, select on sequence public.student_profile_audit_id_seq to service_role;

do $$
declare r record; sid uuid; detail record;
begin
  for r in
    select coalesce(b.package_id, b.id) as package_key,
      (array_agg(b.id order by b.session_index nulls first, b.created_at))[1] as anchor_id,
      (array_agg(b.student_name order by b.session_index nulls first, b.created_at))[1] as full_name,
      (array_agg(b.email order by b.session_index nulls first, b.created_at))[1] as email,
      (array_agg(b.phone order by b.session_index nulls first, b.created_at))[1] as phone
    from public.bookings b group by coalesce(b.package_id, b.id)
  loop
    select d.date_of_birth, d.gender, d.license_number into detail
      from public.booking_student_details d where d.booking_id = r.anchor_id;
    insert into public.student_profiles(full_name,email,phone,date_of_birth,gender,license_number)
      values (r.full_name,r.email,r.phone,detail.date_of_birth,detail.gender,detail.license_number)
      returning id into sid;
    insert into public.student_profile_bookings(student_id,booking_id)
      select sid,b.id from public.bookings b where coalesce(b.package_id,b.id)=r.package_key
      on conflict (booking_id) do nothing;
  end loop;
end $$;

-- Automatically create a separate initial profile for each package identity;
-- linking different packages remains an explicit admin-only action.
create or replace function public.ensure_student_profile_for_booking()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare v_student uuid;
begin
  select l.student_id into v_student from public.student_profile_bookings l
    join public.bookings existing on existing.id=l.booking_id
    where coalesce(existing.package_id,existing.id)=coalesce(new.package_id,new.id) limit 1;
  if v_student is null then
    insert into public.student_profiles(full_name,email,phone)
      values(new.student_name,new.email,new.phone) returning id into v_student;
  end if;
  insert into public.student_profile_bookings(student_id,booking_id) values(v_student,new.id) on conflict(booking_id) do nothing;
  return new;
end $$;
revoke all on function public.ensure_student_profile_for_booking() from public,anon,authenticated;
create trigger bookings_ensure_student_profile after insert on public.bookings
for each row execute function public.ensure_student_profile_for_booking();

create or replace function public.sync_student_profile_identity()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  update public.student_profiles s set date_of_birth=new.date_of_birth,gender=new.gender,license_number=new.license_number,updated_at=now()
  from public.student_profile_bookings l where l.booking_id=new.booking_id and l.student_id=s.id;
  return new;
end $$;
revoke all on function public.sync_student_profile_identity() from public,anon,authenticated;
create trigger booking_student_details_sync_profile after insert or update on public.booking_student_details
for each row execute function public.sync_student_profile_identity();

-- Exact normalized search is performed server-side. The licence is never
-- returned by this function, only opaque linked booking identifiers.
create or replace function public.admin_find_student_bookings_by_license(p_license text)
returns table(booking_id uuid)
language sql security definer set search_path = pg_catalog
as $$
  select distinct l.booking_id
  from public.student_profiles s join public.student_profile_bookings l on l.student_id=s.id
  where regexp_replace(upper(s.license_number), '[^A-Z0-9]', '', 'g') =
        regexp_replace(upper(btrim(p_license)), '[^A-Z0-9]', '', 'g')
  limit 100;
$$;
revoke all on function public.admin_find_student_bookings_by_license(text) from public,anon,authenticated;
grant execute on function public.admin_find_student_bookings_by_license(text) to service_role;

create or replace function public.admin_update_student_profile(
  p_student_id uuid, p_admin_id uuid, p_full_name text, p_email text, p_phone text,
  p_date_of_birth date, p_gender text, p_license_number text
) returns void language plpgsql security definer set search_path=pg_catalog as $$
declare v_fields text[] := '{}'; v_old public.student_profiles%rowtype;
begin
  if p_full_name is null or length(btrim(p_full_name)) not between 1 and 160 or
     p_email is null or length(btrim(p_email)) > 160 or p_phone is null or length(p_phone) > 25 or
     (p_gender is not null and p_gender not in ('woman','man','non_binary','another_identity','prefer_not_to_say')) or
     (p_license_number is not null and length(btrim(p_license_number)) not between 4 and 32) then
    raise exception 'invalid student details';
  end if;
  select * into v_old from public.student_profiles where id=p_student_id for update;
  if not found then raise exception 'student not found'; end if;
  if v_old.full_name is distinct from btrim(p_full_name) then v_fields:=array_append(v_fields,'full_name'); end if;
  if v_old.email is distinct from btrim(p_email) then v_fields:=array_append(v_fields,'email'); end if;
  if v_old.phone is distinct from btrim(p_phone) then v_fields:=array_append(v_fields,'phone'); end if;
  if v_old.date_of_birth is distinct from p_date_of_birth then v_fields:=array_append(v_fields,'date_of_birth'); end if;
  if v_old.gender is distinct from p_gender then v_fields:=array_append(v_fields,'gender'); end if;
  if v_old.license_number is distinct from nullif(btrim(p_license_number),'') then v_fields:=array_append(v_fields,'license_number'); end if;
  update public.student_profiles set full_name=btrim(p_full_name),email=btrim(p_email),phone=btrim(p_phone),
    date_of_birth=p_date_of_birth,gender=p_gender,license_number=nullif(btrim(p_license_number),''),updated_at=now()
    where id=p_student_id;
  update public.bookings b set student_name=btrim(p_full_name),email=btrim(p_email),phone=btrim(p_phone),updated_at=now()
    where b.id in (select l.booking_id from public.student_profile_bookings l where l.student_id=p_student_id);
  update public.booking_student_details d set date_of_birth=p_date_of_birth,gender=p_gender,license_number=nullif(btrim(p_license_number),'')
    where d.booking_id in (select l.booking_id from public.student_profile_bookings l where l.student_id=p_student_id)
      and p_date_of_birth is not null and p_gender is not null and p_license_number is not null;
  if cardinality(v_fields)>0 then
    insert into public.student_profile_audit(student_id,admin_id,action,changed_fields)
      values(p_student_id,p_admin_id,'details_updated',v_fields);
  end if;
end $$;
create or replace function public.admin_link_student_booking(p_student_id uuid,p_booking_id uuid,p_admin_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
  if not exists(select 1 from public.student_profiles where id=p_student_id) or
     not exists(select 1 from public.bookings where id=p_booking_id) then raise exception 'record not found'; end if;
  insert into public.student_profile_bookings(student_id,booking_id)
    select p_student_id,b.id from public.bookings b
    where coalesce(b.package_id,b.id)=(select coalesce(target.package_id,target.id) from public.bookings target where target.id=p_booking_id);
  insert into public.student_profile_audit(student_id,admin_id,action,changed_fields)
    values(p_student_id,p_admin_id,'booking_linked',array['booking_id']);
end $$;
create or replace function public.admin_add_student_assessment(
  p_student_id uuid,p_booking_id uuid,p_admin_id uuid,p_assessment_date date,
  p_vehicle_control smallint,p_observation smallint,p_intersections smallint,p_lane_changes smallint,
  p_speed_space smallint,p_parking smallint,p_hazard_awareness smallint,p_road_test_date date,
  p_road_test_location text,p_road_test_outcome text,p_notes text
) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare v_id uuid;
begin
  if not exists(select 1 from public.student_profiles where id=p_student_id) or
     (p_booking_id is not null and not exists(select 1 from public.student_profile_bookings where student_id=p_student_id and booking_id=p_booking_id)) then
    raise exception 'booking is not linked to this student';
  end if;
  insert into public.student_assessments(student_id,booking_id,admin_id,assessment_date,vehicle_control,observation,
    intersections,lane_changes,speed_space,parking,hazard_awareness,road_test_date,road_test_location,road_test_outcome,notes)
  values(p_student_id,p_booking_id,p_admin_id,p_assessment_date,p_vehicle_control,p_observation,p_intersections,
    p_lane_changes,p_speed_space,p_parking,p_hazard_awareness,p_road_test_date,left(coalesce(p_road_test_location,''),120),
    p_road_test_outcome,left(coalesce(p_notes,''),4000)) returning id into v_id;
  insert into public.student_profile_audit(student_id,admin_id,action,changed_fields)
    values(p_student_id,p_admin_id,'assessment_created',array['assessment']);
  return v_id;
end $$;
revoke all on function public.admin_update_student_profile(uuid,uuid,text,text,text,date,text,text),
  public.admin_link_student_booking(uuid,uuid,uuid),
  public.admin_add_student_assessment(uuid,uuid,uuid,date,smallint,smallint,smallint,smallint,smallint,smallint,smallint,date,text,text,text)
  from public,anon,authenticated;
grant execute on function public.admin_update_student_profile(uuid,uuid,text,text,text,date,text,text),
  public.admin_link_student_booking(uuid,uuid,uuid),
  public.admin_add_student_assessment(uuid,uuid,uuid,date,smallint,smallint,smallint,smallint,smallint,smallint,smallint,date,text,text,text)
  to service_role;
