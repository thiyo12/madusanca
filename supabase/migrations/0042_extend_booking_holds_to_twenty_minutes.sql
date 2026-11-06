-- Keep server-created temporary booking holds, RPC validation and unpaid
-- booking expiry aligned at twenty minutes. Active Stripe checkout expiry is
-- preserved as before.
create or replace function public.hold_booking_slots(p_token_hash text,p_slots jsonb,p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v_slot record; v_local_start timestamp; v_weekday integer; v_minute integer;
  v_rule public.availability_rules%rowtype; v_override public.availability_date_overrides%rowtype;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' or p_expires_at is null or p_expires_at <= now()
    or p_expires_at > now()+interval '20 minutes 15 seconds' or jsonb_typeof(p_slots) is distinct from 'array'
    or jsonb_array_length(p_slots)<1 or jsonb_array_length(p_slots)>200 then
    return jsonb_build_object('ok',false,'error','not_found'); end if;
  if exists(select 1 from jsonb_array_elements(p_slots) s(value) where jsonb_typeof(s.value)<>'object'
    or not(s.value?'startsAt') or not(s.value?'durationMin') or (s.value->>'durationMin') !~ '^[0-9]+$'
    or (s.value->>'durationMin')::integer not between 15 and 600) then
    return jsonb_build_object('ok',false,'error','not_found'); end if;
  if exists(select 1 from jsonb_array_elements(p_slots) with ordinality a(value,ord)
    join jsonb_array_elements(p_slots) with ordinality b(value,ord) on a.ord<b.ord
    where (a.value->>'startsAt')::timestamptz < (b.value->>'startsAt')::timestamptz + make_interval(mins=>public.booking_occupied_duration_min((b.value->>'durationMin')::integer))
    and (b.value->>'startsAt')::timestamptz < (a.value->>'startsAt')::timestamptz + make_interval(mins=>public.booking_occupied_duration_min((a.value->>'durationMin')::integer))) then
    return jsonb_build_object('ok',false,'error','conflict'); end if;
  perform set_config('app.booking_hold_token_hash',p_token_hash,true);
  delete from public.booking_slot_holds where expires_at<=now();
  for v_slot in select (value->>'startsAt')::timestamptz starts_at from jsonb_array_elements(p_slots) order by 1 loop perform public.lock_booking_day(v_slot.starts_at); end loop;
  for v_slot in select (value->>'startsAt')::timestamptz starts_at,(value->>'durationMin')::integer duration_min from jsonb_array_elements(p_slots) order by 1 loop
    if v_slot.starts_at<now()+interval '120 minutes' or public.booking_overlaps(v_slot.starts_at,v_slot.starts_at+make_interval(mins=>v_slot.duration_min)) then return jsonb_build_object('ok',false,'error','conflict'); end if;
    v_local_start:=v_slot.starts_at at time zone 'America/Vancouver'; v_weekday:=extract(dow from v_local_start)::integer;
    v_minute:=extract(hour from v_local_start)::integer*60+extract(minute from v_local_start)::integer;
    select * into v_rule from public.availability_rules where weekday=v_weekday;
    select * into v_override from public.availability_date_overrides where date=v_local_start::date;
    if found then v_rule.start_min:=v_override.start_min; v_rule.end_min:=v_override.end_min; end if;
    if v_rule.weekday is null or v_minute<v_rule.start_min or v_minute+public.booking_occupied_duration_min(v_slot.duration_min)>v_rule.end_min
      or mod(v_minute-v_rule.start_min,case when v_slot.duration_min=90 then 120 else 30 end)<>0
      or extract(second from v_local_start)<>0 or exists(select 1 from public.blackout_dates where date=v_local_start::date) then
      return jsonb_build_object('ok',false,'error','not_found'); end if;
  end loop;
  delete from public.booking_slot_holds where hold_token_hash=p_token_hash;
  insert into public.booking_slot_holds(hold_token_hash,starts_at,duration_min,expires_at)
    select p_token_hash,(value->>'startsAt')::timestamptz,(value->>'durationMin')::integer,p_expires_at from jsonb_array_elements(p_slots);
  return jsonb_build_object('ok',true,'expiresAt',p_expires_at);
exception when unique_violation then return jsonb_build_object('ok',false,'error','conflict'); end $$;
revoke all on function public.hold_booking_slots(text,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.hold_booking_slots(text,jsonb,timestamptz) to service_role;

update public.bookings b set stripe_checkout_expires_at=least(coalesce(b.stripe_checkout_expires_at,b.created_at+interval '20 minutes'),b.created_at+interval '20 minutes')
where b.status='pending_payment' and b.payment_status='due' and not exists(select 1 from public.bookings x where coalesce(x.package_id,x.id)=coalesce(b.package_id,b.id) and x.stripe_checkout_session_id is not null);
create or replace function public.cap_unpaid_booking_hold() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if new.status='pending_payment' and new.payment_status='due' and new.stripe_checkout_session_id is null then
    new.stripe_checkout_expires_at:=least(coalesce(new.stripe_checkout_expires_at,coalesce(new.created_at,now())+interval '20 minutes'),coalesce(new.created_at,now())+interval '20 minutes');
  end if;
  return new;
end $$;
revoke all on function public.cap_unpaid_booking_hold() from public,anon,authenticated;
