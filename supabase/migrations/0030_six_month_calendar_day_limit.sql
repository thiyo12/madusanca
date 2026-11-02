-- The UI exposes the entire final calendar day six months ahead. Match that
-- day-based limit in SQL instead of rejecting evening slots after the exact
-- wall-clock instant six months from now.
do $$
declare
  v_definition text;
  v_old_limit text := 'v_anchor_start > now() + interval ''6 months''';
  v_new_limit text := '(v_anchor_start at time zone ''America/Vancouver'')::date > ((now() at time zone ''America/Vancouver'')::date + interval ''6 months'')::date';
begin
  select pg_get_functiondef(
    'public.create_booking_bundle(text,timestamptz,jsonb,text,text,text,text)'::regprocedure
  ) into v_definition;

  if position(v_old_limit in v_definition) = 0 then
    raise exception 'Expected the six-month timestamp limit in create_booking_bundle';
  end if;

  execute replace(v_definition, v_old_limit, v_new_limit);
end;
$$;
