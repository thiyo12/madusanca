-- Completing one appointment must not close every other session in its package.
create or replace function public.complete_booking_session(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_booking public.bookings%rowtype;
  v_package_id uuid;
begin
  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_booking.status in ('cancelled', 'completed') then
    return jsonb_build_object('ok', false, 'error', 'not_modifiable');
  end if;

  v_package_id := coalesce(v_booking.package_id, v_booking.id);
  -- Serialize completions within a package so concurrent final-session
  -- completions cannot both observe the other appointment as still active.
  perform pg_advisory_xact_lock(hashtext('complete-booking-package:' || v_package_id::text));
  update public.bookings
  set status = 'completed', updated_at = now()
  where id = p_booking_id
  returning * into v_booking;

  if not exists (
    select 1 from public.bookings
    where package_id = v_package_id and status not in ('cancelled', 'completed')
  ) then
    delete from public.booking_tokens
    where booking_id in (select id from public.bookings where package_id = v_package_id);
  end if;

  return jsonb_build_object('ok', true, 'record', to_jsonb(v_booking));
end;
$$;

revoke all on function public.complete_booking_session(uuid) from public, anon, authenticated;
grant execute on function public.complete_booking_session(uuid) to service_role;
