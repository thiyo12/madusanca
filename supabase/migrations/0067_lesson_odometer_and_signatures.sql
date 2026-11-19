alter table public.student_assessments
  add column start_odometer_km integer,
  add column end_odometer_km integer,
  add column student_signature jsonb,
  add column instructor_signature jsonb,
  add constraint student_assessments_odometer_check check (
    ((start_odometer_km is null) = (end_odometer_km is null)) and
    (start_odometer_km is null or start_odometer_km >= 0) and
    (end_odometer_km is null or end_odometer_km >= 0) and
    (start_odometer_km is null or end_odometer_km is null or end_odometer_km >= start_odometer_km)
  ),
  add constraint student_assessments_signature_size_check check (
    (student_signature is null or (jsonb_typeof(student_signature) = 'array' and octet_length(student_signature::text) <= 50000)) and
    (instructor_signature is null or (jsonb_typeof(instructor_signature) = 'array' and octet_length(instructor_signature::text) <= 50000))
  );

create or replace function public.admin_save_booking_assessment_with_vehicle(
  p_student_id uuid, p_booking_id uuid, p_admin_id uuid, p_assessment_date date,
  p_vehicle_control smallint, p_observation smallint, p_intersections smallint,
  p_lane_changes smallint, p_speed_space smallint, p_parking smallint,
  p_hazard_awareness smallint, p_road_test_date date, p_road_test_location text,
  p_road_test_outcome text, p_notes text, p_rubric_scores jsonb,
  p_section_comments jsonb, p_start_odometer_km integer, p_end_odometer_km integer,
  p_student_signature jsonb, p_instructor_signature jsonb
) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare
  v_id uuid;
begin
  if p_start_odometer_km is null or p_end_odometer_km is null or
     p_start_odometer_km < 0 or p_end_odometer_km < 0 or
     (p_start_odometer_km is not null and p_end_odometer_km is not null and p_end_odometer_km < p_start_odometer_km) or
     (p_student_signature is not null and
       (jsonb_typeof(p_student_signature) <> 'array' or octet_length(p_student_signature::text) > 50000)) or
     (p_instructor_signature is not null and
       (jsonb_typeof(p_instructor_signature) <> 'array' or octet_length(p_instructor_signature::text) > 50000)) then
    raise exception 'invalid lesson vehicle readings or signatures';
  end if;

  v_id := public.admin_save_booking_assessment(
    p_student_id, p_booking_id, p_admin_id, p_assessment_date,
    p_vehicle_control, p_observation, p_intersections, p_lane_changes,
    p_speed_space, p_parking, p_hazard_awareness, p_road_test_date,
    p_road_test_location, p_road_test_outcome, p_notes,
    p_rubric_scores, p_section_comments
  );

  update public.student_assessments
  set start_odometer_km = p_start_odometer_km,
      end_odometer_km = p_end_odometer_km,
      student_signature = p_student_signature,
      instructor_signature = p_instructor_signature,
      updated_at = now()
  where id = v_id and student_id = p_student_id and booking_id = p_booking_id;

  return v_id;
end $$;

revoke all on function public.admin_save_booking_assessment_with_vehicle(
  uuid,uuid,uuid,date,smallint,smallint,smallint,smallint,smallint,smallint,
  smallint,date,text,text,text,jsonb,jsonb,integer,integer,jsonb,jsonb
) from public, anon, authenticated;
grant execute on function public.admin_save_booking_assessment_with_vehicle(
  uuid,uuid,uuid,date,smallint,smallint,smallint,smallint,smallint,smallint,
  smallint,date,text,text,text,jsonb,jsonb,integer,integer,jsonb,jsonb
) to service_role;
