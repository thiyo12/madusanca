-- A saved school assessment is required before a lesson can be completed.
alter table public.student_assessments
  add column updated_at timestamptz not null default now();

alter table public.student_profile_audit
  drop constraint if exists student_profile_audit_action_check;
alter table public.student_profile_audit
  add constraint student_profile_audit_action_check
  check (action in ('created','details_updated','booking_linked','assessment_created','assessment_saved','course_completed'));

create table public.student_course_completions (
  student_id uuid not null references public.student_profiles(id) on delete cascade,
  course_key uuid not null,
  ended_early boolean not null default false,
  expected_lessons integer not null check (expected_lessons > 0),
  completed_lessons integer not null check (completed_lessons > 0 and completed_lessons <= expected_lessons),
  finished_at timestamptz not null default now(),
  admin_id uuid not null,
  primary key (student_id, course_key)
);
alter table public.student_course_completions enable row level security;
revoke all on public.student_course_completions from public, anon, authenticated;
grant select, insert, update, delete on public.student_course_completions to service_role;

create or replace function public.admin_save_booking_assessment(
  p_student_id uuid, p_booking_id uuid, p_admin_id uuid, p_assessment_date date,
  p_vehicle_control smallint, p_observation smallint, p_intersections smallint,
  p_lane_changes smallint, p_speed_space smallint, p_parking smallint,
  p_hazard_awareness smallint, p_road_test_date date, p_road_test_location text,
  p_road_test_outcome text, p_notes text
) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare
  v_id uuid;
  v_status text;
begin
  if p_assessment_date is null or p_notes is null or length(p_notes)>4000 or
     (p_vehicle_control is null and p_observation is null and p_intersections is null and
      p_lane_changes is null and p_speed_space is null and p_parking is null and p_hazard_awareness is null) or
     (p_road_test_outcome is not null and p_road_test_outcome not in ('passed','not_passed','not_taken')) then
    raise exception 'invalid lesson report';
  end if;
  if exists (select 1 from unnest(array[p_vehicle_control,p_observation,p_intersections,p_lane_changes,p_speed_space,p_parking,p_hazard_awareness]) score where score is not null and score not between 1 and 5) then
    raise exception 'invalid lesson score';
  end if;

  perform pg_advisory_xact_lock(hashtext('student-assessment:' || p_booking_id::text));
  select b.status into v_status
    from public.bookings b
    join public.student_profile_bookings l on l.booking_id=b.id and l.student_id=p_student_id
    where b.id=p_booking_id;
  if not found then raise exception 'booking is not linked to this student'; end if;
  if v_status in ('cancelled','no_show') then raise exception 'this booking cannot have a lesson report'; end if;

  select a.id into v_id from public.student_assessments a
    where a.student_id=p_student_id and a.booking_id=p_booking_id
    order by a.updated_at desc, a.created_at desc limit 1 for update;

  if v_id is null then
    insert into public.student_assessments(
      student_id,booking_id,admin_id,assessment_date,vehicle_control,observation,
      intersections,lane_changes,speed_space,parking,hazard_awareness,road_test_date,
      road_test_location,road_test_outcome,notes
    ) values (
      p_student_id,p_booking_id,p_admin_id,p_assessment_date,p_vehicle_control,p_observation,
      p_intersections,p_lane_changes,p_speed_space,p_parking,p_hazard_awareness,p_road_test_date,
      left(coalesce(p_road_test_location,''),120),p_road_test_outcome,left(p_notes,4000)
    ) returning id into v_id;
  else
    update public.student_assessments set
      admin_id=p_admin_id,assessment_date=p_assessment_date,vehicle_control=p_vehicle_control,
      observation=p_observation,intersections=p_intersections,lane_changes=p_lane_changes,
      speed_space=p_speed_space,parking=p_parking,hazard_awareness=p_hazard_awareness,
      road_test_date=p_road_test_date,road_test_location=left(coalesce(p_road_test_location,''),120),
      road_test_outcome=p_road_test_outcome,notes=left(p_notes,4000),updated_at=now()
      where id=v_id;
  end if;
  insert into public.student_profile_audit(student_id,admin_id,action,changed_fields)
    values(p_student_id,p_admin_id,'assessment_saved',array['lesson_report']);
  return v_id;
end $$;
revoke all on function public.admin_save_booking_assessment(uuid,uuid,uuid,date,smallint,smallint,smallint,smallint,smallint,smallint,smallint,date,text,text,text) from public,anon,authenticated;
grant execute on function public.admin_save_booking_assessment(uuid,uuid,uuid,date,smallint,smallint,smallint,smallint,smallint,smallint,smallint,date,text,text,text) to service_role;

-- A package may be closed as complete, or explicitly ended early. Unused
-- bookings are not changed and are never misrepresented as completed lessons.
create or replace function public.admin_finish_student_course(
  p_student_id uuid, p_course_key uuid, p_admin_id uuid, p_ended_early boolean
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  v_expected integer;
  v_completed integer;
begin
  perform pg_advisory_xact_lock(hashtext('student-course:' || p_student_id::text || ':' || p_course_key::text));
  select greatest(coalesce(max(b.session_count),count(*)::integer),count(*)::integer),
         count(*) filter (where b.status='completed')::integer
    into v_expected,v_completed
    from public.bookings b
    join public.student_profile_bookings l on l.booking_id=b.id and l.student_id=p_student_id
    where coalesce(b.package_id,b.id)=p_course_key;
  if v_expected is null or v_expected=0 then
    return jsonb_build_object('ok',false,'error','course_not_found');
  end if;
  if v_completed=0 then
    return jsonb_build_object('ok',false,'error','no_completed_lessons');
  end if;
  if not p_ended_early and v_completed<v_expected then
    return jsonb_build_object('ok',false,'error','lessons_remaining');
  end if;
  if p_ended_early and v_completed>=v_expected then
    return jsonb_build_object('ok',false,'error','course_already_complete');
  end if;
  if exists (
    select 1 from public.bookings b
    join public.student_profile_bookings l on l.booking_id=b.id and l.student_id=p_student_id
    where coalesce(b.package_id,b.id)=p_course_key and b.status='completed'
      and not exists(select 1 from public.student_assessments a where a.student_id=p_student_id and a.booking_id=b.id)
  ) then
    return jsonb_build_object('ok',false,'error','report_missing');
  end if;
  insert into public.student_course_completions(student_id,course_key,ended_early,expected_lessons,completed_lessons,admin_id)
    values(p_student_id,p_course_key,p_ended_early,v_expected,v_completed,p_admin_id)
    on conflict (student_id,course_key) do nothing;
  if not found then
    return jsonb_build_object('ok',false,'error','course_already_closed');
  end if;
  insert into public.student_profile_audit(student_id,admin_id,action,changed_fields)
    values(p_student_id,p_admin_id,'course_completed',array['course_key','ended_early']);
  return jsonb_build_object('ok',true,'expected',v_expected,'completed',v_completed);
end $$;
revoke all on function public.admin_finish_student_course(uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.admin_finish_student_course(uuid,uuid,uuid,boolean) to service_role;

-- Keep the existing package-scoped completion behavior, while requiring a
-- meaningful saved report for the session being completed.
create or replace function public.complete_booking_session(p_booking_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v_booking public.bookings%rowtype; v_package_id uuid;
begin
  select * into v_booking from public.bookings where id=p_booking_id for update;
  if not found then return jsonb_build_object('ok',false,'error','not_found'); end if;
  if v_booking.status in ('cancelled','completed') then return jsonb_build_object('ok',false,'error','not_modifiable'); end if;
  if not exists (
    select 1 from public.student_profile_bookings l
    join public.student_assessments a on a.student_id=l.student_id and a.booking_id=l.booking_id
    where l.booking_id=p_booking_id and (
      a.vehicle_control is not null or a.observation is not null or a.intersections is not null or
      a.lane_changes is not null or a.speed_space is not null or a.parking is not null or a.hazard_awareness is not null
    )
  ) then return jsonb_build_object('ok',false,'error','report_required'); end if;

  v_package_id:=coalesce(v_booking.package_id,v_booking.id);
  perform pg_advisory_xact_lock(hashtext('complete-booking-package:' || v_package_id::text));
  update public.bookings set status='completed',updated_at=now() where id=p_booking_id returning * into v_booking;
  if not exists(select 1 from public.bookings where coalesce(package_id,id)=v_package_id and status not in ('cancelled','completed')) then
    delete from public.booking_tokens where booking_id in (select id from public.bookings where coalesce(package_id,id)=v_package_id);
  end if;
  return jsonb_build_object('ok',true,'record',to_jsonb(v_booking));
end $$;
revoke all on function public.complete_booking_session(uuid) from public,anon,authenticated;
grant execute on function public.complete_booking_session(uuid) to service_role;
