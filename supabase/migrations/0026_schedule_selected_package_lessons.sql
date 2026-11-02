-- Hold every appointment selected across the primary package and add-on
-- packages in one booking group, then consume add-on lesson balances when the
-- combined Checkout payment succeeds.
create table if not exists public.booking_checkout_addon_schedule_holds (
  booking_id uuid not null references public.bookings(id) on delete cascade,
  lesson_id text not null,
  session_booking_id uuid not null unique references public.bookings(id) on delete cascade,
  primary key (booking_id, session_booking_id)
);

create table if not exists public.booking_checkout_addon_scheduled_sessions (
  attempt_id uuid not null references public.booking_checkout_addon_attempts(id) on delete cascade,
  purchase_id uuid not null references public.package_purchases(id) on delete cascade,
  session_booking_id uuid not null references public.bookings(id),
  primary key (attempt_id, purchase_id, session_booking_id),
  unique (attempt_id, session_booking_id)
);

alter table public.booking_checkout_addon_schedule_holds enable row level security;
alter table public.booking_checkout_addon_scheduled_sessions enable row level security;
revoke all on public.booking_checkout_addon_schedule_holds,
  public.booking_checkout_addon_scheduled_sessions from public, anon, authenticated;
grant select, insert, update, delete on public.booking_checkout_addon_schedule_holds,
  public.booking_checkout_addon_scheduled_sessions to service_role;

create or replace function public.create_booking_bundle(
  p_token_hash text,
  p_token_expires_at timestamptz,
  p_packages jsonb,
  p_student_name text,
  p_email text,
  p_phone text,
  p_notes text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_package_id uuid := gen_random_uuid();
  v_root_booking_id uuid;
  v_main_lesson public.lessons%rowtype;
  v_lesson public.lessons%rowtype;
  v_selection jsonb;
  v_start timestamptz;
  v_end timestamptz;
  v_session_ids uuid[];
  v_total_sessions integer;
  v_total_price numeric;
  v_index integer := 0;
  v_selection_index integer := 0;
  v_quantity integer;
  v_group_cents bigint;
  v_group_count integer;
  v_base_cents bigint;
  v_remainder bigint;
  v_row public.bookings%rowtype;
  v_records jsonb := '[]'::jsonb;
  v_min_start timestamptz;
  v_anchor_start timestamptz;
  v_max_date date;
  v_local_start timestamp;
  v_weekday integer;
  v_minute integer;
  v_step integer;
  v_rule public.availability_rules%rowtype;
begin
  if p_token_hash is null or length(p_token_hash) <> 64 or p_token_expires_at is null or p_token_expires_at <= now() or
     jsonb_typeof(p_packages) is distinct from 'array' or jsonb_array_length(p_packages) < 1 or jsonb_array_length(p_packages) > 20 or
     p_student_name is null or length(btrim(p_student_name)) < 2 or p_email is null or length(btrim(p_email)) < 3 then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_packages) with ordinality as e(value, ordinality)
    where jsonb_typeof(e.value) <> 'object' or not (e.value ? 'lessonId') or not (e.value ? 'quantity') or not (e.value ? 'startsAt')
      or jsonb_typeof(e.value->'startsAt') <> 'array'
      or (e.value->>'quantity') is null or (e.value->>'quantity') !~ '^[0-9]+$'
      or (e.value->>'quantity')::numeric not between 1 and 100000
      or (e.ordinality = 1 and (e.value->>'quantity')::integer <> 1)
      or (e.ordinality > 1 and e.value->>'lessonId' in (select p.value->>'lessonId' from jsonb_array_elements(p_packages) with ordinality as p(value, ordinality) where p.ordinality > 1 group by p.value->>'lessonId' having count(*) > 1))
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select l.* into v_main_lesson
  from public.lessons l
  join jsonb_array_elements(p_packages) with ordinality as e(value, ordinality)
    on l.id = e.value->>'lessonId' and e.ordinality = 1;
  if not found or jsonb_array_length(p_packages->0->'startsAt') <> v_main_lesson.session_count then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  v_anchor_start := (p_packages->0->'startsAt'->>0)::timestamptz;

  if exists (
    select 1
    from jsonb_array_elements(p_packages) with ordinality as e(value, ordinality)
    left join public.lessons l on l.id = e.value->>'lessonId'
    where l.id is null or (e.ordinality > 1 and l.category <> 'package') or
      jsonb_array_length(e.value->'startsAt') <> l.session_count * (e.value->>'quantity')::integer
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select count(*)::integer, min(parsed.starts_at), (
    select sum(l2.price_cad * (e2.value->>'quantity')::integer)
    from jsonb_array_elements(p_packages) as e2(value)
    join public.lessons l2 on l2.id = e2.value->>'lessonId'
  )
    into v_total_sessions, v_min_start, v_total_price
  from jsonb_array_elements(p_packages) with ordinality as e(value, ordinality)
  join public.lessons l on l.id = e.value->>'lessonId'
  cross join lateral jsonb_array_elements_text(e.value->'startsAt') with ordinality as s(value, ordinality)
  cross join lateral (select s.value::timestamptz as starts_at) as parsed;
  -- Recompute a safe, capped subtotal (the previous aggregate above also
  -- verifies that all selected timestamps are parseable).
  if v_total_sessions < 1 or v_total_sessions > 200 or v_total_price > 999999.99 or v_min_start is null or v_anchor_start is null or
     v_anchor_start < now() + interval '120 minutes' or v_anchor_start > now() + interval '90 days' then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  v_max_date := ((v_anchor_start at time zone 'America/Vancouver')::date + interval '2 months')::date;
  if exists (
    select 1
    from (
      select s.value::timestamptz as starts_at
      from jsonb_array_elements(p_packages) e(value)
      cross join lateral jsonb_array_elements_text(e.value->'startsAt') s(value)
    ) selected
    group by selected.starts_at having count(*) > 1
  ) then
    return jsonb_build_object('ok', false, 'error', 'conflict');
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_packages) e(value)
    cross join lateral jsonb_array_elements_text(e.value->'startsAt') s(value)
    where (s.value::timestamptz at time zone 'America/Vancouver')::date < (v_anchor_start at time zone 'America/Vancouver')::date
       or (s.value::timestamptz at time zone 'America/Vancouver')::date > v_max_date
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_packages) e(value)
    join public.lessons l on l.id = e.value->>'lessonId'
    cross join lateral jsonb_array_elements_text(e.value->'startsAt') s(value)
    where s.value::timestamptz is null
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_packages) e(value)
    join public.lessons l on l.id = e.value->>'lessonId'
    cross join lateral jsonb_array_elements_text(e.value->'startsAt') s(value)
    join public.availability_rules r on r.weekday = extract(dow from (s.value::timestamptz at time zone 'America/Vancouver'))::integer
    where (s.value::timestamptz at time zone 'America/Vancouver')::date in (select date from public.blackout_dates)
       or extract(hour from (s.value::timestamptz at time zone 'America/Vancouver'))::integer * 60 + extract(minute from (s.value::timestamptz at time zone 'America/Vancouver'))::integer < r.start_min
       or extract(hour from (s.value::timestamptz at time zone 'America/Vancouver'))::integer * 60 + extract(minute from (s.value::timestamptz at time zone 'America/Vancouver'))::integer + public.booking_occupied_duration_min(l.duration_min) > r.end_min
       or mod(
         extract(hour from (s.value::timestamptz at time zone 'America/Vancouver'))::integer * 60 + extract(minute from (s.value::timestamptz at time zone 'America/Vancouver'))::integer - r.start_min,
         case when l.duration_min = 90 then 120 else 30 end
       ) <> 0
       or extract(second from (s.value::timestamptz at time zone 'America/Vancouver')) <> 0
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_packages) a(value)
    join public.lessons la on la.id = a.value->>'lessonId'
    cross join lateral jsonb_array_elements_text(a.value->'startsAt') sa(value)
    join jsonb_array_elements(p_packages) b(value) on true
    join public.lessons lb on lb.id = b.value->>'lessonId'
    cross join lateral jsonb_array_elements_text(b.value->'startsAt') sb(value)
    where sa.value::timestamptz < sb.value::timestamptz
      and sb.value::timestamptz < sa.value::timestamptz + make_interval(mins => public.booking_occupied_duration_min(la.duration_min))
      and sa.value::timestamptz < sb.value::timestamptz + make_interval(mins => public.booking_occupied_duration_min(lb.duration_min))
  ) then
    return jsonb_build_object('ok', false, 'error', 'conflict');
  end if;

  for v_start in
    select s.value::timestamptz
    from jsonb_array_elements(p_packages) e(value)
    cross join lateral jsonb_array_elements_text(e.value->'startsAt') s(value)
    order by (s.value::timestamptz at time zone 'UTC')::date, s.value::timestamptz
  loop
    perform public.lock_booking_day(v_start);
  end loop;

  for v_selection in
    select e.value from jsonb_array_elements(p_packages) with ordinality e(value, ordinality) order by e.ordinality
  loop
    v_selection_index := v_selection_index + 1;
    select * into v_lesson from public.lessons
    where id = v_selection->>'lessonId' and (v_selection_index = 1 or category = 'package');
    v_quantity := (v_selection->>'quantity')::integer;
    select count(*)::integer into v_group_count from jsonb_array_elements_text(v_selection->'startsAt');
    v_group_cents := round(v_lesson.price_cad * v_quantity * 100)::bigint;
    v_base_cents := v_group_cents / v_group_count;
    v_remainder := mod(v_group_cents, v_group_count);
    v_index := 0;
    v_session_ids := '{}';
    for v_start in select value::timestamptz from jsonb_array_elements_text(v_selection->'startsAt') order by value::timestamptz loop
      v_end := v_start + make_interval(mins => v_lesson.duration_min);
      if public.booking_overlaps(v_start, v_end) then
        return jsonb_build_object('ok', false, 'error', 'conflict');
      end if;
      v_local_start := v_start at time zone 'America/Vancouver';
      v_weekday := extract(dow from v_local_start)::integer;
      v_minute := extract(hour from v_local_start)::integer * 60 + extract(minute from v_local_start)::integer;
      v_step := case when v_lesson.duration_min = 90 then 120 else 30 end;
      select * into v_rule from public.availability_rules where weekday = v_weekday;
      if not found or v_minute < v_rule.start_min or v_minute + public.booking_occupied_duration_min(v_lesson.duration_min) > v_rule.end_min or
         mod(v_minute - v_rule.start_min, v_step) <> 0 or extract(second from v_local_start) <> 0 or
         exists (select 1 from public.blackout_dates where date = v_local_start::date) then
        return jsonb_build_object('ok', false, 'error', 'not_found');
      end if;

      v_index := v_index + 1;
      insert into public.bookings (
        package_id, session_index, session_count, package_price_cad, package_window_start,
        reference, lesson_id, lesson_name, duration_min, price_cad,
        starts_at, ends_at, student_name, email, phone, notes, status, payment_status, stripe_checkout_expires_at
      ) values (
        v_package_id, (select count(*)::integer from public.bookings where package_id = v_package_id) + 1, v_total_sessions,
        v_main_lesson.price_cad,
        (v_anchor_start at time zone 'America/Vancouver')::date,
        public.new_reference(), v_lesson.id, v_lesson.name, v_lesson.duration_min,
        (v_base_cents + case when v_index <= v_remainder then 1 else 0 end)::numeric / 100,
        v_start, v_end, btrim(p_student_name), lower(btrim(p_email)), coalesce(btrim(p_phone), ''),
        coalesce(btrim(p_notes), ''), 'pending_payment', 'due', now() + interval '31 minutes'
      ) returning * into v_row;
      v_records := v_records || jsonb_build_array(to_jsonb(v_row));
      v_session_ids := array_append(v_session_ids, v_row.id);
      if v_root_booking_id is null then
        v_root_booking_id := v_row.id;
        insert into public.booking_tokens (token_hash, booking_id, expires_at)
        values (p_token_hash, v_root_booking_id, p_token_expires_at);
      end if;
    end loop;
    if v_selection_index > 1 then
      insert into public.booking_checkout_addon_schedule_holds (booking_id, lesson_id, session_booking_id)
      select v_root_booking_id, v_lesson.id, unnest(v_session_ids);
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'records', v_records);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'conflict');
end;
$$;

revoke all on function public.create_booking_bundle(text, timestamptz, jsonb, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_booking_bundle(text, timestamptz, jsonb, text, text, text, text) to service_role;

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
  v_package_id uuid;
  v_attempt_id uuid;
  v_lesson public.lessons%rowtype;
  v_purchase_id uuid;
  v_selections jsonb := coalesce(p_addon_packages, '[]'::jsonb);
  v_saved jsonb;
  v_selection jsonb;
  v_quantity integer;
  v_total numeric;
begin
  if p_session_id is null or length(p_session_id) < 8 or p_expires_at is null or p_expires_at <= now() or jsonb_typeof(v_selections) is distinct from 'array' or jsonb_array_length(v_selections) > 20 then
    return false;
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_selections) as e(value)
    where jsonb_typeof(e.value) <> 'object' or not (e.value ? 'lessonId') or not (e.value ? 'quantity')
      or (e.value->>'lessonId') is null or length(e.value->>'lessonId') not between 1 and 64
      or (e.value->>'quantity') is null or (e.value->>'quantity') !~ '^[0-9]+$'
  ) or (select count(*) from jsonb_array_elements(v_selections)) <>
       (select count(distinct e.value->>'lessonId') from jsonb_array_elements(v_selections) as e(value)) then
    return false;
  end if;
  if exists (select 1 from jsonb_array_elements(v_selections) as e(value) where (e.value->>'quantity')::numeric not between 1 and 100000) then
    return false;
  end if;
  select coalesce(sum(l.price_cad * (e.value->>'quantity')::integer), 0) into v_total
  from jsonb_array_elements(v_selections) as e(value)
  join public.lessons l on l.id = e.value->>'lessonId' and l.category = 'package';
  if (select count(*) from jsonb_array_elements(v_selections)) <>
     (select count(*) from jsonb_array_elements(v_selections) as e(value) join public.lessons l on l.id = e.value->>'lessonId' and l.category = 'package') or
     v_total + (select package_price_cad from public.bookings where id = p_booking_id) > 999999.99 then
    return false;
  end if;

  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found or v_booking.status not in ('pending_payment', 'confirmed', 'rescheduled') or v_booking.payment_status <> 'due' or v_booking.starts_at <> p_expected_starts_at then
    return false;
  end if;
  v_package_id := coalesce(v_booking.package_id, v_booking.id);

  select id into v_attempt_id from public.booking_checkout_addon_attempts where stripe_checkout_session_id = p_session_id and booking_id = p_booking_id;
  if found then
    select coalesce(jsonb_agg(jsonb_build_object('lessonId', i.lesson_id, 'quantity', round(p.credits_purchased::numeric / l.session_count)::integer) order by i.lesson_id), '[]'::jsonb)
      into v_saved
    from public.booking_checkout_addon_items i join public.package_purchases p on p.id = i.purchase_id join public.lessons l on l.id = i.lesson_id
    where i.attempt_id = v_attempt_id;
    select coalesce(jsonb_agg(jsonb_build_object('lessonId', e.value->>'lessonId', 'quantity', (e.value->>'quantity')::integer) order by e.value->>'lessonId'), '[]'::jsonb)
      into v_selections from jsonb_array_elements(v_selections) as e(value);
    return v_booking.stripe_checkout_session_id = p_session_id and v_saved = v_selections;
  end if;

  if exists (select 1 from public.booking_checkout_addon_schedule_holds h where h.booking_id = p_booking_id) then
    if exists (
      select 1 from jsonb_array_elements(v_selections) as e(value)
      join public.lessons l on l.id = e.value->>'lessonId' and l.category = 'package'
      where (select count(*) from public.booking_checkout_addon_schedule_holds h where h.booking_id = p_booking_id and h.lesson_id = l.id) <> l.session_count * (e.value->>'quantity')::integer
    ) then
      return false;
    end if;
    if exists (
      select 1 from public.booking_checkout_addon_schedule_holds h
      where h.booking_id = p_booking_id and not exists (select 1 from jsonb_array_elements(v_selections) e(value) where e.value->>'lessonId' = h.lesson_id)
    ) then
      return false;
    end if;
  end if;

  update public.bookings set stripe_checkout_session_id = case when id = p_booking_id then p_session_id else null end,
    stripe_checkout_expires_at = p_expires_at, updated_at = now()
  where package_id = v_package_id;
  insert into public.booking_checkout_addon_attempts (booking_id, stripe_checkout_session_id)
  values (p_booking_id, p_session_id) returning id into v_attempt_id;

  for v_selection in select e.value from jsonb_array_elements(v_selections) as e(value) order by e.value->>'lessonId'
  loop
    v_quantity := (v_selection->>'quantity')::integer;
    select * into v_lesson from public.lessons where id = v_selection->>'lessonId' and category = 'package';
    insert into public.package_purchases (
      reference, student_name, email, phone, notes, lesson_id, lesson_name, duration_min,
      credits_purchased, amount_cad, currency, payment_status, source
    ) values (
      'WDA-A-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
      v_booking.student_name, v_booking.email, v_booking.phone, '', v_lesson.id, v_lesson.name,
      v_lesson.duration_min, v_lesson.session_count * v_quantity, v_lesson.price_cad * v_quantity,
      'cad', 'pending', 'new'
    ) returning id into v_purchase_id;
    insert into public.booking_checkout_addon_items (attempt_id, purchase_id, lesson_id) values (v_attempt_id, v_purchase_id, v_lesson.id);
    if exists (select 1 from public.booking_checkout_addon_schedule_holds where booking_id = p_booking_id) then
      insert into public.booking_checkout_addon_scheduled_sessions (attempt_id, purchase_id, session_booking_id)
      select v_attempt_id, v_purchase_id, h.session_booking_id
      from public.booking_checkout_addon_schedule_holds h
      where h.booking_id = p_booking_id and h.lesson_id = v_lesson.id;
    end if;
  end loop;
  return true;
end;
$$;

revoke all on function public.set_booking_checkout_session_with_addons(uuid, text, timestamptz, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.set_booking_checkout_session_with_addons(uuid, text, timestamptz, timestamptz, jsonb) to service_role;

create or replace function public.record_stripe_checkout_event(
  p_event_id text,
  p_event_type text,
  p_booking_id uuid,
  p_session_id text,
  p_payment_intent_id text default null,
  p_invoice_id text default null,
  p_invoice_url text default null,
  p_subtotal_cents bigint default null,
  p_tax_cents bigint default null,
  p_total_cents bigint default null,
  p_currency text default null
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_booking public.bookings%rowtype;
  v_package_id uuid;
  v_addon_total_cents bigint;
  v_attempt_id uuid;
  v_paid_at timestamptz := now();
  v_valid_until timestamptz;
  v_updated integer;
begin
  if p_event_type not in ('paid', 'expired') then raise exception 'Unsupported Stripe checkout event kind: %', p_event_type; end if;
  select * into v_booking from public.bookings where id = p_booking_id and stripe_checkout_session_id = p_session_id for update;
  if not found or v_booking.payment_status <> 'due' then return false; end if;
  v_package_id := coalesce(v_booking.package_id, v_booking.id);
  select a.id into v_attempt_id from public.booking_checkout_addon_attempts a where a.booking_id = p_booking_id and a.stripe_checkout_session_id = p_session_id for update;
  select coalesce(round(sum(p.amount_cad * 100))::bigint, 0) into v_addon_total_cents
  from public.booking_checkout_addon_items i join public.package_purchases p on p.id = i.purchase_id where i.attempt_id = v_attempt_id;

  if p_event_type = 'paid' and (
    p_subtotal_cents is distinct from round((v_booking.package_price_cad + v_addon_total_cents::numeric / 100) * 100)::bigint or
    p_tax_cents is null or p_tax_cents < 0 or p_total_cents is distinct from p_subtotal_cents + p_tax_cents or lower(coalesce(p_currency, '')) <> 'cad'
  ) then return false; end if;

  insert into public.stripe_webhook_events (event_id, event_type) values (p_event_id, p_event_type) on conflict (event_id) do nothing;
  if not found then return false; end if;

  if p_event_type = 'paid' then
    update public.bookings set payment_status = 'paid', status = case when status = 'pending_payment' then 'confirmed' else status end,
      stripe_payment_intent_id = p_payment_intent_id, stripe_invoice_id = p_invoice_id, stripe_invoice_url = p_invoice_url,
      stripe_subtotal_cad = p_subtotal_cents::numeric / 100, stripe_tax_cad = p_tax_cents::numeric / 100,
      stripe_total_cad = p_total_cents::numeric / 100, stripe_currency = lower(coalesce(p_currency, 'cad')),
      stripe_checkout_expires_at = null, updated_at = now()
    where package_id = v_package_id and payment_status = 'due';
    get diagnostics v_updated = row_count;
    if v_updated = 0 then raise exception 'Checkout payment no longer matches a payable booking'; end if;

    if v_attempt_id is not null then
      v_valid_until := (v_paid_at at time zone 'America/Vancouver' + interval '6 months') at time zone 'America/Vancouver';
      update public.package_purchases p set payment_status = 'paid', purchased_at = v_paid_at, valid_until = v_valid_until,
        stripe_payment_intent_id = p_payment_intent_id, stripe_invoice_id = p_invoice_id, stripe_invoice_url = p_invoice_url,
        stripe_subtotal_cad = p.amount_cad, updated_at = now()
      from public.booking_checkout_addon_items i where i.attempt_id = v_attempt_id and p.id = i.purchase_id and p.payment_status = 'pending';
      insert into public.package_credit_events (purchase_id, event_type, quantity_delta, source_key, note)
      select p.id, 'grant', p.credits_purchased, 'booking-addon-grant:' || p.id::text, 'Lessons granted after verified combined booking payment.'
      from public.booking_checkout_addon_items i join public.package_purchases p on p.id = i.purchase_id where i.attempt_id = v_attempt_id
      on conflict (source_key) do nothing;
      insert into public.package_credit_events (purchase_id, booking_id, event_type, quantity_delta, source_key, note)
      select s.purchase_id, s.session_booking_id, 'redeem', -1,
        'booking-addon-redeem:' || s.purchase_id::text || ':' || s.session_booking_id::text,
        'Lesson scheduled as part of the combined booking checkout.'
      from public.booking_checkout_addon_scheduled_sessions s where s.attempt_id = v_attempt_id
      on conflict (source_key) do nothing;
      update public.booking_checkout_addon_attempts set status = 'paid' where id = v_attempt_id;
    end if;
  else
    update public.bookings set stripe_checkout_session_id = null,
      stripe_checkout_expires_at = case when status = 'pending_payment' then now() else null end,
      stripe_checkout_attempt = stripe_checkout_attempt + 1, updated_at = now()
    where package_id = v_package_id and payment_status = 'due';
    if v_attempt_id is not null then
      update public.package_purchases p set payment_status = 'failed', updated_at = now()
      from public.booking_checkout_addon_items i where i.attempt_id = v_attempt_id and p.id = i.purchase_id and p.payment_status = 'pending';
      update public.booking_checkout_addon_attempts set status = 'expired' where id = v_attempt_id;
    end if;
  end if;
  return true;
end;
$$;

revoke all on function public.record_stripe_checkout_event(text, text, uuid, text, text, text, text, bigint, bigint, bigint, text) from public, anon, authenticated;
grant execute on function public.record_stripe_checkout_event(text, text, uuid, text, text, text, text, bigint, bigint, bigint, text) to service_role;
