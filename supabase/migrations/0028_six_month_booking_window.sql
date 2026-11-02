-- The bundle RPC was introduced in 0026 and is wrapped by 0027 to store
-- private student details. Replace only its booking-window intervals so the
-- wrapper continues to call the same atomic reservation function.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.create_booking_bundle(text,timestamptz,jsonb,text,text,text,text)'::regprocedure
  ) into v_definition;

  if position('interval ''90 days''' in v_definition) = 0 or
     position('interval ''2 months''' in v_definition) = 0 then
    raise exception 'create_booking_bundle definition changed; review its window before applying the six-month update';
  end if;

  v_definition := replace(v_definition, 'interval ''90 days''', 'interval ''6 months''');
  v_definition := replace(v_definition, 'interval ''2 months''', 'interval ''6 months''');
  execute v_definition;
end;
$$;
