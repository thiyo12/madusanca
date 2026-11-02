-- Keep legacy package creation and post-booking rescheduling aligned with the
-- six-month window used by the current booking wizard.
do $$
declare
  v_signature text;
  v_definition text;
begin
  foreach v_signature in array array[
    'public.create_booking_package(text,timestamptz,text,text,integer,numeric,timestamptz[],text,text,text,text)',
    'public.reschedule_package_session_by_token(text,uuid,timestamptz,timestamptz,text,timestamptz)',
    'public.admin_reschedule_package_session(uuid,timestamptz,timestamptz,text,timestamptz)'
  ] loop
    select pg_get_functiondef(v_signature::regprocedure) into v_definition;
    if position('interval ''2 months''' in v_definition) = 0 then
      raise exception 'Expected a two-month package-window check in %', v_signature;
    end if;
    v_definition := replace(v_definition, 'interval ''2 months''', 'interval ''6 months''');
    v_definition := replace(v_definition, 'interval ''90 days''', 'interval ''6 months''');
    execute v_definition;
  end loop;
end;
$$;
