-- Allow a package purchase to contain any reasonable number of identical
-- catalogue packs while retaining one purchase/credit-ledger row per pack type.
alter table public.package_purchases
  drop constraint if exists package_purchases_credits_purchased_check;
alter table public.package_purchases
  add constraint package_purchases_credits_purchased_check
  check (credits_purchased between 1 and 2_000_000);

drop function if exists public.set_booking_checkout_session_with_addons(uuid, text, timestamptz, timestamptz, text[]);

create or replace function public.set_booking_checkout_session_with_addons(
  p_booking_id uuid,
  p_session_id text,
  p_expires_at timestamptz,
  p_expected_starts_at timestamptz,
  p_addon_packages jsonb default '[]'::jsonb
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_booking public.bookings%rowtype;
  v_attempt_id uuid;
  v_lesson public.lessons%rowtype;
  v_purchase_id uuid;
  v_selections jsonb := coalesce(p_addon_packages, '[]'::jsonb);
  v_saved jsonb;
  v_selection jsonb;
  v_quantity integer;
  v_total numeric;
begin
  if p_session_id is null or length(p_session_id) < 8 or p_expires_at is null or p_expires_at <= now() or
     jsonb_typeof(v_selections) is distinct from 'array' then
    return false;
  end if;
  if jsonb_array_length(v_selections) > 20 then
    return false;
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_selections) as e(value)
    where jsonb_typeof(e.value) <> 'object'
      or not (e.value ? 'lessonId') or not (e.value ? 'quantity')
      or (e.value->>'lessonId') is null or length(e.value->>'lessonId') not between 1 and 64
      or (e.value->>'quantity') is null or (e.value->>'quantity') !~ '^[0-9]+$'
  ) or (select count(*) from jsonb_array_elements(v_selections)) <>
       (select count(distinct e.value->>'lessonId') from jsonb_array_elements(v_selections) as e(value)) then
    return false;
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_selections) as e(value)
    where (e.value->>'quantity')::numeric not between 1 and 100000
  ) then
    return false;
  end if;
  select coalesce(sum(l.price_cad * (e.value->>'quantity')::integer), 0)
    into v_total
  from jsonb_array_elements(v_selections) as e(value)
  join public.lessons l on l.id = e.value->>'lessonId' and l.category = 'package';
  if (select count(*) from jsonb_array_elements(v_selections)) <>
     (select count(*) from jsonb_array_elements(v_selections) as e(value) join public.lessons l on l.id = e.value->>'lessonId' and l.category = 'package') or
     v_total + (select package_price_cad from public.bookings where id = p_booking_id) > 999999.99 then
    return false;
  end if;

  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found or v_booking.status not in ('pending_payment', 'confirmed', 'rescheduled') or
     v_booking.payment_status <> 'due' or v_booking.starts_at <> p_expected_starts_at then
    return false;
  end if;

  select id into v_attempt_id from public.booking_checkout_addon_attempts
  where stripe_checkout_session_id = p_session_id and booking_id = p_booking_id;
  if found then
    select coalesce(jsonb_agg(jsonb_build_object(
      'lessonId', i.lesson_id,
      'quantity', round(p.credits_purchased::numeric / l.session_count)::integer
    ) order by i.lesson_id), '[]'::jsonb) into v_saved
    from public.booking_checkout_addon_items i
    join public.package_purchases p on p.id = i.purchase_id
    join public.lessons l on l.id = i.lesson_id
    where i.attempt_id = v_attempt_id;
    select coalesce(jsonb_agg(jsonb_build_object('lessonId', e.value->>'lessonId', 'quantity', (e.value->>'quantity')::integer) order by e.value->>'lessonId'), '[]'::jsonb)
      into v_selections from jsonb_array_elements(v_selections) as e(value);
    return v_booking.stripe_checkout_session_id = p_session_id and v_saved = v_selections;
  end if;

  update public.bookings
  set stripe_checkout_session_id = p_session_id,
      stripe_checkout_expires_at = p_expires_at,
      updated_at = now()
  where id = p_booking_id;

  insert into public.booking_checkout_addon_attempts (booking_id, stripe_checkout_session_id)
  values (p_booking_id, p_session_id)
  returning id into v_attempt_id;

  for v_selection in select e.value from jsonb_array_elements(v_selections) as e(value) order by e.value->>'lessonId'
  loop
    v_quantity := (v_selection->>'quantity')::integer;
    select * into v_lesson from public.lessons
    where id = v_selection->>'lessonId' and category = 'package';
    insert into public.package_purchases (
      reference, student_name, email, phone, notes, lesson_id, lesson_name,
      duration_min, credits_purchased, amount_cad, currency, payment_status, source
    ) values (
      'WDA-A-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
      v_booking.student_name, v_booking.email, v_booking.phone, '',
      v_lesson.id, v_lesson.name, v_lesson.duration_min,
      v_lesson.session_count * v_quantity, v_lesson.price_cad * v_quantity,
      'cad', 'pending', 'new'
    ) returning id into v_purchase_id;
    insert into public.booking_checkout_addon_items (attempt_id, purchase_id, lesson_id)
    values (v_attempt_id, v_purchase_id, v_lesson.id);
  end loop;
  return true;
end;
$$;

revoke all on function public.set_booking_checkout_session_with_addons(uuid, text, timestamptz, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.set_booking_checkout_session_with_addons(uuid, text, timestamptz, timestamptz, jsonb)
  to service_role;
