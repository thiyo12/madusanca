-- A date-specific availability override replaces the weekly schedule, even on
-- a weekday with no regular rule. Keep add-on checkout validation consistent
-- with the availability API and the booking table triggers.
do $$
declare
  v_definition text;
  v_before text;
  v_old_block text := $old$
    select * into v_rule from public.availability_rules where weekday = v_weekday;
    if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    v_start_min := v_rule.start_min;
    v_end_min := v_rule.end_min;
    select * into v_override from public.availability_date_overrides where date = v_local_start::date;
    if found then
      v_start_min := v_override.start_min;
      v_end_min := v_override.end_min;
    end if;$old$;
  v_new_block text := $new$
    select * into v_rule from public.availability_rules where weekday = v_weekday;
    select * into v_override from public.availability_date_overrides where date = v_local_start::date;
    if found then
      v_start_min := v_override.start_min;
      v_end_min := v_override.end_min;
    else
      if v_rule.weekday is null then
        return jsonb_build_object('ok', false, 'error', 'not_found');
      end if;
      v_start_min := v_rule.start_min;
      v_end_min := v_rule.end_min;
    end if;$new$;
begin
  select pg_get_functiondef(
    'public.create_scheduled_package_purchase_checkout(uuid,text,text,integer,numeric,jsonb,text,text,timestamptz,text)'::regprocedure
  ) into v_definition;
  v_before := v_definition;
  v_definition := replace(v_definition, v_old_block, v_new_block);
  if v_definition = v_before then
    raise exception 'Expected weekly-only add-on availability check was not found';
  end if;
  execute v_definition;
end;
$$;
