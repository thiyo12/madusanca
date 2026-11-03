begin;

do $$
declare
  v_start timestamptz;
  v_result jsonb;
begin
  select ((candidate::date + time '09:00') at time zone 'America/Vancouver')
    into v_start
  from generate_series(current_date + 14, current_date + 90, interval '1 day') candidate
  where extract(dow from candidate)::integer = 6
    and not exists (select 1 from public.blackout_dates b where b.date = candidate::date)
  order by candidate
  limit 1;

  if v_start is null then
    raise exception 'Could not find a Saturday for the booking hold regression test';
  end if;

  v_result := public.hold_booking_slots(
    repeat('d', 64),
    jsonb_build_array(
      jsonb_build_object('startsAt', v_start, 'durationMin', 90),
      jsonb_build_object('startsAt', v_start + interval '2 hours', 'durationMin', 90)
    ),
    now() + interval '8 minutes'
  );
  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'Expected both package lessons to be held atomically, got %', v_result;
  end if;

  v_result := public.hold_booking_slots(
    repeat('e', 64),
    jsonb_build_array(jsonb_build_object('startsAt', v_start, 'durationMin', 90)),
    now() + interval '8 minutes'
  );
  if coalesce((v_result->>'ok')::boolean, false) or v_result->>'error' <> 'conflict' then
    raise exception 'A second customer must not hold an occupied time, got %', v_result;
  end if;

  if not public.booking_overlaps(v_start, v_start + interval '90 minutes') then
    raise exception 'Active holds must participate in the 120-minute booking conflict check';
  end if;

  perform public.release_booking_slots(repeat('d', 64));
  if public.booking_overlaps(v_start, v_start + interval '90 minutes') then
    raise exception 'Released holds must stop blocking availability';
  end if;
end;
$$;

rollback;
