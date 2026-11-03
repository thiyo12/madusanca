begin;

do $$
declare
  v_date date;
  v_rule public.availability_rules%rowtype;
  v_result jsonb;
  v_start timestamptz;
  v_inside_start timestamptz;
begin
  select d::date into v_date
  from generate_series(current_date + 14, current_date + 90, interval '1 day') d
  join public.availability_rules r on r.weekday = extract(dow from d)::integer
  where extract(dow from d)::integer = 1
    and r.end_min >= r.start_min + 360
    and not exists (select 1 from public.blackout_dates b where b.date = d::date)
  order by d
  limit 1;

  if v_date is null then raise exception 'Could not find an open Monday for the date override fixture'; end if;
  select * into v_rule from public.availability_rules where weekday = extract(dow from v_date)::integer;

  perform public.set_availability_date_override(v_date, v_rule.start_min, v_rule.start_min + 240);
  v_inside_start := ((v_date + make_interval(mins => v_rule.start_min)) at time zone 'America/Vancouver');
  v_result := public.hold_booking_slots(
    repeat('b', 64),
    jsonb_build_array(jsonb_build_object('startsAt', v_inside_start, 'durationMin', 90)),
    now() + interval '8 minutes'
  );
  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'A slot inside the date override should be holdable, got %', v_result;
  end if;

  v_start := ((v_date + make_interval(mins => v_rule.start_min + 240)) at time zone 'America/Vancouver');
  v_result := public.hold_booking_slots(
    repeat('a', 64),
    jsonb_build_array(jsonb_build_object('startsAt', v_start, 'durationMin', 90)),
    now() + interval '8 minutes'
  );
  if coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'A 90-minute lesson must not start at the end of a date override';
  end if;

  perform public.release_booking_slots(repeat('b', 64));
  perform public.remove_availability_date_override(v_date);
end;
$$;

rollback;
