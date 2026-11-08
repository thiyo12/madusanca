-- Recording cash against one booking must not implicitly pay every session in
-- its package. After that booking's 20-minute hold expires, validate only that
-- lesson's slot; siblings retain their own payment and hold state.
create or replace function public.mark_booking_paid_by_cash(p_booking_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_booking public.bookings%rowtype;
  v_package_id uuid;
  v_local_start timestamp;
  v_weekday integer;
  v_minute integer;
  v_occupied integer;
  v_rule public.availability_rules%rowtype;
  v_override public.availability_date_overrides%rowtype;
begin
  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found or v_booking.payment_status <> 'due'
     or v_booking.status in ('cancelled', 'completed') then
    return false;
  end if;

  v_package_id := coalesce(v_booking.package_id, v_booking.id);
  perform public.lock_booking_day(v_booking.starts_at);

  if v_booking.status = 'pending_payment'
     and (v_booking.stripe_checkout_expires_at is null
          or v_booking.stripe_checkout_expires_at <= now()) then
    v_local_start := v_booking.starts_at at time zone 'America/Vancouver';
    v_weekday := extract(dow from v_local_start)::integer;
    v_minute := extract(hour from v_local_start)::integer * 60
      + extract(minute from v_local_start)::integer;
    v_occupied := public.booking_occupied_duration_min(v_booking.duration_min);

    select * into v_rule from public.availability_rules where weekday = v_weekday;
    select * into v_override from public.availability_date_overrides where date = v_local_start::date;
    if not found then
      v_override.start_min := null;
      v_override.end_min := null;
    end if;

    if v_rule.weekday is null
       or v_minute < coalesce(v_override.start_min, v_rule.start_min)
       or v_minute + v_occupied > coalesce(v_override.end_min, v_rule.end_min)
       or mod(v_minute - coalesce(v_override.start_min, v_rule.start_min),
              public.booking_start_cadence_min(v_booking.duration_min)) <> 0
       or extract(second from v_local_start) <> 0
       or exists (select 1 from public.blackout_dates where date = v_local_start::date)
       or exists (
         select 1 from public.bookings b
         where coalesce(b.package_id, b.id) <> v_package_id
           and (b.status in ('confirmed', 'rescheduled') or
             (b.status = 'pending_payment' and b.payment_status = 'due'
              and b.stripe_checkout_expires_at > now()))
           and b.starts_at < v_booking.starts_at + make_interval(mins => v_occupied)
           and v_booking.starts_at < b.starts_at
             + make_interval(mins => public.booking_occupied_duration_min(b.duration_min))
       ) or exists (
         select 1 from public.booking_upgrade_slots s
         join public.bookings anchor on anchor.id = s.booking_id
         where coalesce(anchor.package_id, anchor.id) <> v_package_id
           and s.starts_at < v_booking.starts_at + make_interval(mins => v_occupied)
           and v_booking.starts_at < public.booking_interval_occupied_end(s.starts_at, s.ends_at)
       ) or exists (
         select 1 from public.booking_slot_holds h
         where h.expires_at > now()
           and h.starts_at < v_booking.starts_at + make_interval(mins => v_occupied)
           and v_booking.starts_at < h.starts_at
             + make_interval(mins => public.booking_occupied_duration_min(h.duration_min))
       ) then
      return false;
    end if;
  end if;

  update public.bookings
  set payment_status = 'paid',
      status = case when status = 'pending_payment' then 'confirmed' else status end,
      stripe_checkout_expires_at = null,
      updated_at = now()
  where id = p_booking_id and payment_status = 'due'
    and status not in ('cancelled', 'completed');
  return found;
end;
$$;

revoke all on function public.mark_booking_paid_by_cash(uuid) from public, anon, authenticated;
grant execute on function public.mark_booking_paid_by_cash(uuid) to service_role;
