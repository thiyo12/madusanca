-- Road Tests remain 45-minute appointments to customers but, like regular
-- 90-minute lessons, reserve a 120-minute instructor block and start every
-- two hours. Availability and booking guards use these helpers dynamically.
create or replace function public.booking_occupied_duration_min(p_duration_min integer)
returns integer
language sql
immutable
set search_path = pg_catalog
as $$
  select case when p_duration_min in (45, 90) then 120
              else p_duration_min end;
$$;

create or replace function public.booking_start_cadence_min(p_duration_min integer)
returns integer
language sql
immutable
set search_path = pg_catalog
as $$
  select case when p_duration_min in (45, 90) then 120
              else 30 end;
$$;

revoke all on function public.booking_occupied_duration_min(integer) from public, anon, authenticated;
grant execute on function public.booking_occupied_duration_min(integer) to service_role;
revoke all on function public.booking_start_cadence_min(integer) from public, anon, authenticated;
grant execute on function public.booking_start_cadence_min(integer) to service_role;
