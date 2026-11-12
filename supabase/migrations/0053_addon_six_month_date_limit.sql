-- The add-on calendar offers the entire final local date six months ahead.
-- Match that date-based window in the database instead of rejecting times on
-- that day which fall after the exact current-time-plus-six-months instant.
do $$
declare
  v_definition text;
  v_before text;
  v_old_limit text := 'v_first > v_now + interval ''6 months''';
  v_new_limit text := '(v_first at time zone ''America/Vancouver'')::date > ((v_now at time zone ''America/Vancouver'')::date + interval ''6 months'')::date';
begin
  select pg_get_functiondef(
    'public.create_scheduled_package_purchase_checkout(uuid,text,text,integer,numeric,jsonb,text,text,timestamptz,text)'::regprocedure
  ) into v_definition;
  v_before := v_definition;
  v_definition := replace(v_definition, v_old_limit, v_new_limit);
  if v_definition = v_before then
    raise exception 'Expected exact six-month timestamp limit was not found in add-on purchase routine';
  end if;
  execute v_definition;
end;
$$;
