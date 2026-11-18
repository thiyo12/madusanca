-- Add-ons scheduled from My Booking share the originating course. A later
-- standalone booking has a different package and remains a separate course.
create or replace function public.admin_finish_student_course(
  p_student_id uuid, p_course_key uuid, p_admin_id uuid, p_ended_early boolean
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  v_course_reference text;
  v_expected integer;
  v_completed integer;
  v_finished_at timestamptz := now();
  v_addon_prefix text := 'Added from My Booking ';
begin
  perform pg_advisory_xact_lock(hashtext('student-course:' || p_student_id::text || ':' || p_course_key::text));

  select b.reference into v_course_reference
  from public.bookings b
  join public.student_profile_bookings l on l.booking_id=b.id and l.student_id=p_student_id
  where coalesce(b.package_id,b.id)=p_course_key
  order by b.session_index
  limit 1;
  if v_course_reference is null then
    return jsonb_build_object('ok',false,'error','course_not_found');
  end if;

  with course_bookings as (
    select b.* from public.bookings b
    join public.student_profile_bookings l on l.booking_id=b.id and l.student_id=p_student_id
    where coalesce(b.package_id,b.id)=p_course_key
       or b.notes=v_addon_prefix || v_course_reference
  ), package_counts as (
    select coalesce(package_id,id) as package_key,
      greatest(coalesce(max(session_count),count(*)::integer),count(*)::integer) as expected,
      count(*) filter (where status='completed')::integer as completed
    from course_bookings
    group by coalesce(package_id,id)
  )
  select coalesce(sum(expected),0)::integer, coalesce(sum(completed),0)::integer
  into v_expected,v_completed from package_counts;

  if v_expected=0 then return jsonb_build_object('ok',false,'error','course_not_found'); end if;
  if v_completed=0 then return jsonb_build_object('ok',false,'error','no_completed_lessons'); end if;
  if not p_ended_early and v_completed<v_expected then
    return jsonb_build_object('ok',false,'error','lessons_remaining');
  end if;
  if p_ended_early and v_completed>=v_expected then
    return jsonb_build_object('ok',false,'error','course_already_complete');
  end if;
  if exists (
    select 1 from public.bookings b
    join public.student_profile_bookings l on l.booking_id=b.id and l.student_id=p_student_id
    where (coalesce(b.package_id,b.id)=p_course_key or b.notes=v_addon_prefix || v_course_reference)
      and b.status='completed'
      and not exists(select 1 from public.student_assessments a where a.student_id=p_student_id and a.booking_id=b.id)
  ) then return jsonb_build_object('ok',false,'error','report_missing'); end if;

  insert into public.student_course_completions(student_id,course_key,ended_early,expected_lessons,completed_lessons,finished_at,admin_id)
    values(p_student_id,p_course_key,p_ended_early,v_expected,v_completed,v_finished_at,p_admin_id)
    on conflict (student_id,course_key) do nothing;
  if not found then return jsonb_build_object('ok',false,'error','course_already_closed'); end if;

  -- Keep the course's private manage link available for 45 days after closure.
  update public.booking_tokens t set expires_at=v_finished_at + interval '45 days'
  where t.booking_id in (
    select b.id from public.bookings b
    join public.student_profile_bookings l on l.booking_id=b.id and l.student_id=p_student_id
    where coalesce(b.package_id,b.id)=p_course_key or b.notes=v_addon_prefix || v_course_reference
  );
  update public.package_purchase_tokens t set expires_at=v_finished_at + interval '45 days'
  where t.purchase_id in (
    select distinct b.purchase_id from public.bookings b
    join public.student_profile_bookings l on l.booking_id=b.id and l.student_id=p_student_id
    where b.purchase_id is not null
      and (coalesce(b.package_id,b.id)=p_course_key or b.notes=v_addon_prefix || v_course_reference)
  );
  insert into public.student_profile_audit(student_id,admin_id,action,changed_fields)
    values(p_student_id,p_admin_id,'course_completed',array['course_key','ended_early']);
  return jsonb_build_object('ok',true,'expected',v_expected,'completed',v_completed,'finished_at',v_finished_at);
end $$;
revoke all on function public.admin_finish_student_course(uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.admin_finish_student_course(uuid,uuid,uuid,boolean) to service_role;

-- Do not delete the only bearer token when the last scheduled lesson is
-- completed. The explicit course-finish action applies the precise 45-day
-- retention limit; unclosed courses keep the ordinary token expiry.
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
      a.lane_changes is not null or a.speed_space is not null or a.parking is not null or a.hazard_awareness is not null or
      jsonb_typeof(a.rubric_scores)='object' and a.rubric_scores <> '{}'::jsonb
    )
  ) then return jsonb_build_object('ok',false,'error','report_required'); end if;
  v_package_id:=coalesce(v_booking.package_id,v_booking.id);
  perform pg_advisory_xact_lock(hashtext('complete-booking-package:' || v_package_id::text));
  update public.bookings set status='completed',updated_at=now() where id=p_booking_id returning * into v_booking;
  return jsonb_build_object('ok',true,'record',to_jsonb(v_booking));
end $$;
revoke all on function public.complete_booking_session(uuid) from public,anon,authenticated;
grant execute on function public.complete_booking_session(uuid) to service_role;
