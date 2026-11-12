-- Store the detailed 1–10 driving rubric and category comments while keeping
-- the existing five-point summary fields for older progress summaries.
alter table public.student_assessments
  add column rubric_scores jsonb not null default '{}'::jsonb,
  add column section_comments jsonb not null default '{}'::jsonb;

drop function public.admin_save_booking_assessment(
  uuid,uuid,uuid,date,smallint,smallint,smallint,smallint,smallint,smallint,smallint,date,text,text,text
);

create function public.admin_save_booking_assessment(
  p_student_id uuid, p_booking_id uuid, p_admin_id uuid, p_assessment_date date,
  p_vehicle_control smallint, p_observation smallint, p_intersections smallint,
  p_lane_changes smallint, p_speed_space smallint, p_parking smallint,
  p_hazard_awareness smallint, p_road_test_date date, p_road_test_location text,
  p_road_test_outcome text, p_notes text,
  p_rubric_scores jsonb, p_section_comments jsonb
) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare
  v_id uuid;
  v_status text;
  v_score_keys text[] := array[
    'observation_360_check','observation_shoulder_check','observation_mirrors_surroundings',
    'speed_special_zone','speed_residential','speed_city_road',
    'parking_reverse_stall','parking_front_in_stall','parking_pull_over','parking_parallel',
    'intersection_two_way_stops','intersection_four_way_stops','intersection_traffic_lights','intersection_roundabouts',
    'vehicle_pre_trip','vehicle_steering','vehicle_braking_acceleration','vehicle_turning_speed',
    'traffic_signs','traffic_road_markings','traffic_emergency_vehicles','traffic_hov_bus_lanes',
    'multi_lane_change','multi_merging','multi_highway',
    'other_pull_away','other_reversing_back','other_narrow_streets','other_refuelling',
    'pedal_hazards','pedal_hills','pedal_turns'
  ];
  v_comment_keys text[] := array[
    'observation','speed','parking','intersection','vehicle_control',
    'traffic_rules','multi_lane_driving','other','appropriate_pedal'
  ];
begin
  if p_assessment_date is null or p_notes is null or length(p_notes)>4000 or
     p_rubric_scores is null or jsonb_typeof(p_rubric_scores) <> 'object' or
     jsonb_object_length(p_rubric_scores) <> cardinality(v_score_keys) or
     exists (
       select 1 from jsonb_each(p_rubric_scores) item
       where not (item.key = any(v_score_keys)) or
         jsonb_typeof(item.value) <> 'number' or
         item.value::text !~ '^(10|[1-9])$'
     ) or
     p_section_comments is null or jsonb_typeof(p_section_comments) <> 'object' or
     jsonb_object_length(p_section_comments) <> cardinality(v_comment_keys) or
     exists (
       select 1 from jsonb_each(p_section_comments) item
       where not (item.key = any(v_comment_keys)) or
         jsonb_typeof(item.value) <> 'string' or length(item.value #>> '{}') > 2000
     ) or
     (p_road_test_outcome is not null and p_road_test_outcome not in ('passed','not_passed','not_taken')) then
    raise exception 'invalid lesson report';
  end if;
  if exists (select 1 from unnest(array[p_vehicle_control,p_observation,p_intersections,p_lane_changes,p_speed_space,p_parking,p_hazard_awareness]) score where score is not null and score not between 1 and 5) then
    raise exception 'invalid lesson summary';
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
      road_test_location,road_test_outcome,notes,rubric_scores,section_comments
    ) values (
      p_student_id,p_booking_id,p_admin_id,p_assessment_date,p_vehicle_control,p_observation,
      p_intersections,p_lane_changes,p_speed_space,p_parking,p_hazard_awareness,p_road_test_date,
      left(coalesce(p_road_test_location,''),120),p_road_test_outcome,left(p_notes,4000),p_rubric_scores,p_section_comments
    ) returning id into v_id;
  else
    update public.student_assessments set
      admin_id=p_admin_id,assessment_date=p_assessment_date,vehicle_control=p_vehicle_control,
      observation=p_observation,intersections=p_intersections,lane_changes=p_lane_changes,
      speed_space=p_speed_space,parking=p_parking,hazard_awareness=p_hazard_awareness,
      road_test_date=p_road_test_date,road_test_location=left(coalesce(p_road_test_location,''),120),
      road_test_outcome=p_road_test_outcome,notes=left(p_notes,4000),
      rubric_scores=p_rubric_scores,section_comments=p_section_comments,updated_at=now()
      where id=v_id;
  end if;
  insert into public.student_profile_audit(student_id,admin_id,action,changed_fields)
    values(p_student_id,p_admin_id,'assessment_saved',array['lesson_report','rubric_scores','section_comments']);
  return v_id;
end $$;
revoke all on function public.admin_save_booking_assessment(uuid,uuid,uuid,date,smallint,smallint,smallint,smallint,smallint,smallint,smallint,date,text,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.admin_save_booking_assessment(uuid,uuid,uuid,date,smallint,smallint,smallint,smallint,smallint,smallint,smallint,date,text,text,text,jsonb,jsonb) to service_role;

-- Completion still uses the existing legacy summary fields as its saved-report
-- sentinel; the updated action supplies these from the detailed rubric.
