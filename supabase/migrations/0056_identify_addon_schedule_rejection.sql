-- Report the precise add-on schedule rejection and keep a checkout safety
-- buffer between the initial availability check and the database reservation.
do $$
declare
  v_definition text;
  v_before text;
  v_old_window text := $old$
  if v_first is null or v_last is null or v_first < v_now + interval '120 minutes' or
     (v_first at time zone 'America/Vancouver')::date > ((v_now at time zone 'America/Vancouver')::date + interval '6 months')::date then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;$old$;
  v_new_window text := $new$
  if v_first is null or v_last is null then
    return jsonb_build_object('ok', false, 'error', 'not_found', 'failure', 'invalid_schedule');
  end if;
  if v_first < v_now + interval '135 minutes' then
    return jsonb_build_object('ok', false, 'error', 'not_found', 'failure', 'lead_time');
  end if;
  if (v_first at time zone 'America/Vancouver')::date > ((v_now at time zone 'America/Vancouver')::date + interval '6 months')::date then
    return jsonb_build_object('ok', false, 'error', 'not_found', 'failure', 'first_lesson_window');
  end if;$new$;
  v_old_package_window text := $old$
  if v_last_day > (v_first_day + interval '6 months')::date then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;$old$;
  v_new_package_window text := $new$
  if v_last_day > (v_first_day + interval '6 months')::date then
    return jsonb_build_object('ok', false, 'error', 'not_found', 'failure', 'package_window');
  end if;$new$;
  v_old_missing_rule text := $old$
      if v_rule.weekday is null then
        return jsonb_build_object('ok', false, 'error', 'not_found');
      end if;$old$;
  v_new_missing_rule text := $new$
      if v_rule.weekday is null then
        return jsonb_build_object('ok', false, 'error', 'not_found', 'failure', 'weekly_window');
      end if;$new$;
  v_old_schedule_rule text := $old$
    if v_minute < v_start_min or
       v_minute + public.booking_occupied_duration_min(v_lesson.duration_min) > v_end_min or
       mod(v_minute - v_start_min, public.booking_start_cadence_min(v_lesson.duration_min)) <> 0 or
       extract(second from v_local_start) <> 0 or
       exists (select 1 from public.blackout_dates where date = v_local_start::date) then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;$old$;
  v_new_schedule_rule text := $new$
    if v_minute < v_start_min or
       v_minute + public.booking_occupied_duration_min(v_lesson.duration_min) > v_end_min or
       mod(v_minute - v_start_min, public.booking_start_cadence_min(v_lesson.duration_min)) <> 0 or
       extract(second from v_local_start) <> 0 or
       exists (select 1 from public.blackout_dates where date = v_local_start::date) then
      return jsonb_build_object('ok', false, 'error', 'not_found', 'failure', 'schedule_rule');
    end if;$new$;
  v_old_overlap_check text := $old$
    if v_start < v_now + interval '120 minutes' or
       public.booking_overlaps(v_start, v_start + make_interval(mins => v_lesson.duration_min)) then
      return jsonb_build_object('ok', false, 'error', 'conflict');
    end if;$old$;
  v_new_overlap_check text := $new$
    if v_start < v_now + interval '135 minutes' then
      return jsonb_build_object('ok', false, 'error', 'not_found', 'failure', 'lead_time');
    end if;
    if public.booking_overlaps(v_start, v_start + make_interval(mins => v_lesson.duration_min)) then
      return jsonb_build_object('ok', false, 'error', 'conflict');
    end if;$new$;
begin
  select pg_get_functiondef(
    'public.create_scheduled_package_purchase_checkout(uuid,text,text,integer,numeric,jsonb,text,text,timestamptz,text)'::regprocedure
  ) into v_definition;
  v_before := v_definition;
  v_definition := replace(v_definition, v_old_window, v_new_window);
  v_definition := replace(v_definition, v_old_package_window, v_new_package_window);
  v_definition := replace(v_definition, v_old_missing_rule, v_new_missing_rule);
  v_definition := replace(v_definition, v_old_schedule_rule, v_new_schedule_rule);
  v_definition := replace(v_definition, v_old_overlap_check, v_new_overlap_check);
  if v_definition = v_before or
     position($check$'failure', 'lead_time'$check$ in v_definition) = 0 or
     position($check$'failure', 'first_lesson_window'$check$ in v_definition) = 0 or
     position($check$'failure', 'package_window'$check$ in v_definition) = 0 or
     position($check$'failure', 'weekly_window'$check$ in v_definition) = 0 or
     position($check$'failure', 'schedule_rule'$check$ in v_definition) = 0 then
    raise exception 'Could not update all add-on schedule rejection checks';
  end if;
  execute v_definition;
end;
$$;

create or replace function public.create_scheduled_package_purchase_bundle(
  p_purchases jsonb,
  p_manage_token_hash text,
  p_session_id text,
  p_expires_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_item jsonb;
  v_result jsonb;
  v_records jsonb := '[]'::jsonb;
  v_index integer := 0;
  v_id uuid;
  v_child_error text;
  v_child_failure text;
begin
  if jsonb_typeof(p_purchases) is distinct from 'array' or
     jsonb_array_length(p_purchases) < 1 or jsonb_array_length(p_purchases) > 10 or
     p_session_id is null or length(p_session_id) < 8 then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  begin
    for v_item in select value from jsonb_array_elements(p_purchases)
    loop
      v_index := v_index + 1;
      v_id := (v_item->>'id')::uuid;
      v_result := public.create_scheduled_package_purchase_checkout(
        v_id, v_item->>'reference', v_item->>'lesson_id',
        (v_item->>'quantity')::integer, (v_item->>'amount_cad')::numeric,
        v_item->'starts_at', p_manage_token_hash,
        p_session_id || '_bundle_' || v_index::text, p_expires_at,
        v_item->>'notes'
      );
      if coalesce((v_result->>'ok')::boolean, false) is not true then
        v_child_error := v_result->>'error';
        v_child_failure := v_result->>'failure';
        raise exception 'package bundle reservation failed';
      end if;
      update public.package_purchases
        set stripe_checkout_session_id = p_session_id, updated_at = now()
        where id = v_id;
      v_records := v_records || jsonb_build_array(v_result->'record');
    end loop;
    return jsonb_build_object('ok', true, 'records', v_records);
  exception when others then
    return jsonb_build_object(
      'ok', false,
      'error', case when v_child_error in ('conflict', 'not_found', 'not_modifiable')
        then v_child_error else 'conflict' end,
      'failure', v_child_failure
    );
  end;
end;
$$;
revoke all on function public.create_scheduled_package_purchase_bundle(jsonb, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.create_scheduled_package_purchase_bundle(jsonb, text, text, timestamptz) to service_role;
