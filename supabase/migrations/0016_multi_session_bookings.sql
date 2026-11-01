-- Store each lesson appointment as its own calendar row, grouped under one
-- package id and one payment. Existing bookings become one-session packages.
alter table public.bookings
  add column if not exists package_id uuid,
  add column if not exists session_index integer,
  add column if not exists session_count integer,
  add column if not exists package_price_cad numeric(10, 2),
  add column if not exists package_window_start date;

update public.bookings
set package_id = id,
    session_index = 1,
    session_count = 1,
    package_price_cad = price_cad,
    package_window_start = (starts_at at time zone 'America/Vancouver')::date
where package_id is null
   or session_index is null
   or session_count is null
   or package_price_cad is null
   or package_window_start is null;

alter table public.bookings
  alter column package_id set not null,
  alter column session_index set not null,
  alter column session_count set not null,
  alter column package_price_cad set not null,
  alter column package_window_start set not null,
  add constraint bookings_session_index_check check (session_index between 1 and session_count),
  add constraint bookings_session_count_check check (session_count between 1 and 20),
  add constraint bookings_package_price_check check (package_price_cad >= 0);

create index if not exists bookings_package_id_idx on public.bookings (package_id, session_index);
create unique index if not exists bookings_package_session_unique_idx
  on public.bookings (package_id, session_index);

create or replace function public.set_booking_package_defaults()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.package_id := coalesce(new.package_id, new.id);
  new.session_index := coalesce(new.session_index, 1);
  new.session_count := coalesce(new.session_count, 1);
  new.package_price_cad := coalesce(new.package_price_cad, new.price_cad);
  new.package_window_start := coalesce(new.package_window_start, (new.starts_at at time zone 'America/Vancouver')::date);
  return new;
end;
$$;

drop trigger if exists bookings_package_defaults on public.bookings;
create trigger bookings_package_defaults
before insert on public.bookings
for each row execute function public.set_booking_package_defaults();

revoke execute on function public.set_booking_package_defaults() from public, anon, authenticated;

create or replace function public.create_booking_package(
  p_token_hash text,
  p_token_expires_at timestamptz,
  p_lesson_id text,
  p_lesson_name text,
  p_duration_min integer,
  p_package_price_cad numeric,
  p_starts_at timestamptz[],
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
  v_lesson public.lessons%rowtype;
  v_package_id uuid := gen_random_uuid();
  v_count integer;
  v_total_cents bigint;
  v_base_cents bigint;
  v_remainder bigint;
  v_index integer := 0;
  v_start timestamptz;
  v_end timestamptz;
  v_local_start timestamp;
  v_weekday integer;
  v_minute integer;
  v_rule public.availability_rules%rowtype;
  v_row public.bookings%rowtype;
  v_records jsonb := '[]'::jsonb;
begin
  v_count := coalesce(array_length(p_starts_at, 1), 0);
  if p_token_hash is null or length(p_token_hash) <> 64 or
     p_token_expires_at <= now() or v_count < 1 or v_count > 20 or
     p_student_name is null or length(btrim(p_student_name)) < 2 or
     p_email is null or length(btrim(p_email)) < 3 or
     p_duration_min < 15 or p_duration_min > 600 or p_package_price_cad < 0 then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select * into v_lesson from public.lessons where id = p_lesson_id;
  if not found or v_lesson.name <> p_lesson_name or
     v_lesson.duration_min <> p_duration_min or
     v_lesson.price_cad <> p_package_price_cad or
     v_lesson.session_count <> v_count then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if exists (
    select 1 from unnest(p_starts_at) with ordinality s(starts_at, ord)
    where s.starts_at is null or
      (s.ord > 1 and s.starts_at <= p_starts_at[s.ord - 1]) or
      s.starts_at < now() + interval '120 minutes' or
      (s.ord = 1 and s.starts_at > now() + interval '90 days') or
      (s.starts_at at time zone 'America/Vancouver')::date >
        (((p_starts_at[1] at time zone 'America/Vancouver')::date + interval '2 months')::date)
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if exists (
    select 1
    from unnest(p_starts_at) with ordinality a(starts_at, ord)
    join unnest(p_starts_at) with ordinality b(starts_at, ord) on a.ord < b.ord
    where a.starts_at < b.starts_at + make_interval(mins => p_duration_min)
      and b.starts_at < a.starts_at + make_interval(mins => p_duration_min)
  ) then
    return jsonb_build_object('ok', false, 'error', 'conflict');
  end if;

  -- Serialize every selected day in a stable order before checking conflicts.
  for v_start in
    select s.starts_at from unnest(p_starts_at) s(starts_at)
    order by (s.starts_at at time zone 'UTC')::date, s.starts_at
  loop
    perform public.lock_booking_day(v_start);
  end loop;

  foreach v_start in array p_starts_at loop
    v_end := v_start + make_interval(mins => p_duration_min);
    if public.booking_overlaps(v_start, v_end) then
      return jsonb_build_object('ok', false, 'error', 'conflict');
    end if;

    v_local_start := v_start at time zone 'America/Vancouver';
    v_weekday := extract(dow from v_local_start)::integer;
    v_minute := extract(hour from v_local_start)::integer * 60 + extract(minute from v_local_start)::integer;
    select * into v_rule from public.availability_rules where weekday = v_weekday;
    if not found or v_minute < v_rule.start_min or
       v_minute + p_duration_min > v_rule.end_min or v_minute % 30 <> 0 or
       extract(second from v_local_start) <> 0 or
       exists (select 1 from public.blackout_dates where date = v_local_start::date) then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
  end loop;

  v_total_cents := round(p_package_price_cad * 100)::bigint;
  v_base_cents := v_total_cents / v_count;
  v_remainder := mod(v_total_cents, v_count);
  foreach v_start in array p_starts_at loop
    v_index := v_index + 1;
    insert into public.bookings (
      package_id, session_index, session_count, package_price_cad,
      package_window_start,
      reference, lesson_id, lesson_name, duration_min, price_cad,
      starts_at, ends_at, student_name, email, phone, notes, status,
      payment_status, stripe_checkout_expires_at
    ) values (
      v_package_id, v_index, v_count, p_package_price_cad,
      (p_starts_at[1] at time zone 'America/Vancouver')::date,
      public.new_reference(), p_lesson_id, p_lesson_name, p_duration_min,
      (v_base_cents + case when v_index <= v_remainder then 1 else 0 end)::numeric / 100,
      v_start, v_start + make_interval(mins => p_duration_min),
      btrim(p_student_name), lower(btrim(p_email)), coalesce(btrim(p_phone), ''),
      coalesce(p_notes, ''), 'pending_payment', 'due', now() + interval '31 minutes'
    ) returning * into v_row;

    if v_index = 1 then
      insert into public.booking_tokens (token_hash, booking_id, expires_at)
      values (p_token_hash, v_row.id, p_token_expires_at);
    end if;
    v_records := v_records || jsonb_build_array(to_jsonb(v_row));
  end loop;

  return jsonb_build_object('ok', true, 'records', v_records);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'conflict');
end;
$$;

revoke execute on function public.create_booking_package(
  text, timestamptz, text, text, integer, numeric, timestamptz[], text, text, text, text
) from public, anon, authenticated;
grant execute on function public.create_booking_package(
  text, timestamptz, text, text, integer, numeric, timestamptz[], text, text, text, text
) to service_role;

-- One Checkout payment confirms every separately scheduled package session.
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
  v_package_id uuid;
begin
  select package_id into v_package_id
  from public.bookings
  where id = p_booking_id and stripe_checkout_session_id = p_session_id;
  if not found then return false; end if;

  insert into public.stripe_webhook_events (event_id, event_type)
  values (p_event_id, p_event_type)
  on conflict (event_id) do nothing;
  if not found then return false; end if;

  if p_event_type = 'paid' then
    update public.bookings
    set payment_status = 'paid',
        status = case when status = 'pending_payment' then 'confirmed' else status end,
        stripe_payment_intent_id = p_payment_intent_id,
        stripe_invoice_id = p_invoice_id,
        stripe_invoice_url = p_invoice_url,
        stripe_subtotal_cad = case when p_subtotal_cents is null then null else p_subtotal_cents::numeric / 100 end,
        stripe_tax_cad = case when p_tax_cents is null then null else p_tax_cents::numeric / 100 end,
        stripe_total_cad = case when p_total_cents is null then null else p_total_cents::numeric / 100 end,
        stripe_currency = lower(coalesce(p_currency, 'cad')),
        updated_at = now()
    where package_id = v_package_id and payment_status <> 'refunded';
  elsif p_event_type = 'expired' then
    update public.bookings
    set stripe_checkout_session_id = null,
        stripe_checkout_attempt = stripe_checkout_attempt + 1,
        updated_at = now()
    where id = p_booking_id and stripe_checkout_session_id = p_session_id and payment_status = 'due';
  else
    raise exception 'Unsupported Stripe checkout event kind: %', p_event_type;
  end if;
  return true;
end;
$$;

revoke execute on function public.record_stripe_checkout_event(
  text, text, uuid, text, text, text, text, bigint, bigint, bigint, text
) from public, anon, authenticated;
grant execute on function public.record_stripe_checkout_event(
  text, text, uuid, text, text, text, text, bigint, bigint, bigint, text
) to service_role;

-- Completing a student package is package-wide and invalidates its links.
create or replace function public.complete_booking_package(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_package_id uuid;
  v_record public.bookings%rowtype;
begin
  select package_id into v_package_id from public.bookings where id = p_booking_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  update public.bookings set status = 'completed', updated_at = now()
  where package_id = v_package_id;
  delete from public.booking_tokens where booking_id in (
    select id from public.bookings where package_id = v_package_id
  );
  select * into v_record from public.bookings where id = p_booking_id;
  return jsonb_build_object('ok', true, 'record', to_jsonb(v_record));
end;
$$;
revoke execute on function public.complete_booking_package(uuid) from public, anon, authenticated;
grant execute on function public.complete_booking_package(uuid) to service_role;

create or replace function public.admin_cancel_booking_package(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_package_id uuid;
  v_record public.bookings%rowtype;
begin
  select package_id into v_package_id from public.bookings where id = p_booking_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not exists (select 1 from public.bookings where package_id = v_package_id and status not in ('cancelled', 'completed')) then
    return jsonb_build_object('ok', false, 'error', 'not_modifiable');
  end if;
  update public.bookings set status = 'cancelled', updated_at = now()
  where package_id = v_package_id and status <> 'completed';
  select * into v_record from public.bookings where id = p_booking_id;
  return jsonb_build_object('ok', true, 'record', to_jsonb(v_record));
end;
$$;
revoke execute on function public.admin_cancel_booking_package(uuid) from public, anon, authenticated;
grant execute on function public.admin_cancel_booking_package(uuid) to service_role;

create or replace function public.cancel_booking_by_token(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_booking public.bookings%rowtype;
begin
  select b.* into v_booking
  from public.booking_tokens t join public.bookings b on b.id = t.booking_id
  where t.token_hash = p_token_hash and t.expires_at > now()
  for update of b;
  if not found then return jsonb_build_object('ok', false, 'error', 'expired'); end if;
  if not exists (select 1 from public.bookings where package_id = v_booking.package_id and status not in ('cancelled', 'completed')) then
    return jsonb_build_object('ok', false, 'error', 'not_modifiable');
  end if;
  update public.bookings set status = 'cancelled', updated_at = now()
  where package_id = v_booking.package_id and status <> 'completed';
  select * into v_booking from public.bookings where id = v_booking.id;
  return jsonb_build_object('ok', true, 'record', to_jsonb(v_booking));
end;
$$;
revoke execute on function public.cancel_booking_by_token(text) from public, anon, authenticated;
grant execute on function public.cancel_booking_by_token(text) to service_role;

create or replace function public.reschedule_package_session_by_token(
  p_token_hash text,
  p_session_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_new_token_hash text,
  p_new_token_expires_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_anchor public.bookings%rowtype;
  v_target public.bookings%rowtype;
  v_manage_anchor_id uuid;
  v_start_local timestamp;
  v_minute integer;
  v_rule public.availability_rules%rowtype;
begin
  select b.* into v_anchor
  from public.booking_tokens t join public.bookings b on b.id = t.booking_id
  where t.token_hash = p_token_hash and t.expires_at > now()
  for update of b;
  if not found then return jsonb_build_object('ok', false, 'error', 'expired'); end if;

  select * into v_target from public.bookings
  where id = p_session_id and package_id = v_anchor.package_id
  for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select id into v_manage_anchor_id from public.bookings
  where package_id = v_anchor.package_id and session_index = 1;
  if v_manage_anchor_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_target.status in ('cancelled', 'completed') or v_target.starts_at < now() + interval '48 hours' then
    return jsonb_build_object('ok', false, 'error', 'not_modifiable');
  end if;
  if v_target.session_count = 1 and exists (
    select 1 from public.bookings where package_id = v_target.package_id and payment_status = 'paid'
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_modifiable');
  end if;
  if v_target.student_reschedule_count >= 2 then
    return jsonb_build_object('ok', false, 'error', 'reschedule_limit');
  end if;
  if p_starts_at < now() + interval '120 minutes' or p_ends_at <= p_starts_at or p_ends_at - p_starts_at <> make_interval(mins => v_target.duration_min) or
     (p_starts_at at time zone 'America/Vancouver')::date < v_target.package_window_start or
     (p_starts_at at time zone 'America/Vancouver')::date > v_target.package_window_start + interval '2 months' then
    return jsonb_build_object('ok', false, 'error', 'not_modifiable');
  end if;

  perform public.lock_booking_day(p_starts_at);
  if public.booking_overlaps(p_starts_at, p_ends_at, v_target.id) then
    return jsonb_build_object('ok', false, 'error', 'conflict');
  end if;
  v_start_local := p_starts_at at time zone 'America/Vancouver';
  v_minute := extract(hour from v_start_local)::integer * 60 + extract(minute from v_start_local)::integer;
  select * into v_rule from public.availability_rules where weekday = extract(dow from v_start_local)::integer;
  if not found or v_minute < v_rule.start_min or v_minute + v_target.duration_min > v_rule.end_min or
     v_minute % 30 <> 0 or extract(second from v_start_local) <> 0 or
     exists (select 1 from public.blackout_dates where date = v_start_local::date) then
    return jsonb_build_object('ok', false, 'error', 'not_modifiable');
  end if;

  update public.bookings set starts_at = p_starts_at, ends_at = p_ends_at,
    status = 'rescheduled', student_reschedule_count = student_reschedule_count + 1,
    updated_at = now()
  where id = v_target.id returning * into v_target;
  delete from public.booking_tokens where booking_id in (
    select id from public.bookings where package_id = v_anchor.package_id
  );
  insert into public.booking_tokens (token_hash, booking_id, expires_at)
  values (p_new_token_hash, v_manage_anchor_id, p_new_token_expires_at);
  return jsonb_build_object('ok', true, 'record', to_jsonb(v_target));
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'conflict');
end;
$$;
revoke execute on function public.reschedule_package_session_by_token(text, uuid, timestamptz, timestamptz, text, timestamptz) from public, anon, authenticated;
grant execute on function public.reschedule_package_session_by_token(text, uuid, timestamptz, timestamptz, text, timestamptz) to service_role;

create or replace function public.admin_reschedule_package_session(
  p_booking_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_new_token_hash text,
  p_new_token_expires_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_target public.bookings%rowtype;
  v_anchor_id uuid;
  v_local_start timestamp;
  v_minute integer;
  v_rule public.availability_rules%rowtype;
begin
  select * into v_target from public.bookings where id = p_booking_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if v_target.status in ('cancelled', 'completed') then
    return jsonb_build_object('ok', false, 'error', 'not_modifiable');
  end if;
  if p_starts_at < now() + interval '120 minutes' or p_ends_at <= p_starts_at or
     p_ends_at - p_starts_at <> make_interval(mins => v_target.duration_min) or
     (p_starts_at at time zone 'America/Vancouver')::date < v_target.package_window_start or
     (p_starts_at at time zone 'America/Vancouver')::date > (v_target.package_window_start + interval '2 months')::date then
    return jsonb_build_object('ok', false, 'error', 'not_modifiable');
  end if;

  perform public.lock_booking_day(p_starts_at);
  if public.booking_overlaps(p_starts_at, p_ends_at, v_target.id) then
    return jsonb_build_object('ok', false, 'error', 'conflict');
  end if;
  v_local_start := p_starts_at at time zone 'America/Vancouver';
  v_minute := extract(hour from v_local_start)::integer * 60 + extract(minute from v_local_start)::integer;
  select * into v_rule from public.availability_rules where weekday = extract(dow from v_local_start)::integer;
  if not found or v_minute < v_rule.start_min or v_minute + v_target.duration_min > v_rule.end_min or
     v_minute % 30 <> 0 or extract(second from v_local_start) <> 0 or
     exists (select 1 from public.blackout_dates where date = v_local_start::date) then
    return jsonb_build_object('ok', false, 'error', 'not_modifiable');
  end if;

  update public.bookings set starts_at = p_starts_at, ends_at = p_ends_at,
    status = 'rescheduled', updated_at = now()
  where id = v_target.id returning * into v_target;
  select id into v_anchor_id from public.bookings
  where package_id = v_target.package_id and session_index = 1;
  if v_anchor_id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  delete from public.booking_tokens where booking_id in (
    select id from public.bookings where package_id = v_target.package_id
  );
  insert into public.booking_tokens (token_hash, booking_id, expires_at)
  values (p_new_token_hash, v_anchor_id, p_new_token_expires_at);
  return jsonb_build_object('ok', true, 'record', to_jsonb(v_target));
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'conflict');
end;
$$;
revoke execute on function public.admin_reschedule_package_session(uuid, timestamptz, timestamptz, text, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_reschedule_package_session(uuid, timestamptz, timestamptz, text, timestamptz) to service_role;

-- A package upgrade updates every uncompleted session while preserving its dates.
create or replace function public.record_stripe_upgrade_checkout_event(
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
  p_currency text default null,
  p_target_lesson_id text default null,
  p_target_lesson_name text default null,
  p_target_duration_min integer default null,
  p_target_price_cad numeric default null,
  p_from_price_cad numeric default null
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_anchor public.bookings%rowtype;
  v_total_cents bigint;
begin
  select * into v_anchor from public.bookings where id = p_booking_id for update;
  if not found then return false; end if;
  insert into public.stripe_webhook_events (event_id, event_type)
  values (p_event_id, 'upgrade_' || p_event_type)
  on conflict (event_id) do nothing;
  if not found then return false; end if;

  if p_event_type = 'paid' then
    if v_anchor.stripe_upgrade_checkout_session_id <> p_session_id or
       v_anchor.payment_status <> 'paid' or
       v_anchor.stripe_upgrade_from_price_cad <> p_from_price_cad or
       v_anchor.stripe_upgrade_target_lesson_id <> p_target_lesson_id or
       v_anchor.stripe_upgrade_target_lesson_name <> p_target_lesson_name or
       v_anchor.stripe_upgrade_target_duration_min <> p_target_duration_min or
       v_anchor.stripe_upgrade_target_price_cad <> p_target_price_cad or
       p_target_price_cad <= p_from_price_cad then
      return false;
    end if;
    v_total_cents := round(p_target_price_cad * 100)::bigint;
    update public.bookings b
    set lesson_id = p_target_lesson_id,
        lesson_name = p_target_lesson_name,
        duration_min = p_target_duration_min,
        package_price_cad = p_target_price_cad,
        price_cad = (v_total_cents / b.session_count +
          case when b.session_index <= mod(v_total_cents, b.session_count) then 1 else 0 end)::numeric / 100,
        ends_at = b.starts_at + make_interval(mins => p_target_duration_min),
        stripe_payment_intent_id = p_payment_intent_id,
        stripe_invoice_id = p_invoice_id,
        stripe_invoice_url = p_invoice_url,
        stripe_subtotal_cad = case when p_subtotal_cents is null then null else p_subtotal_cents::numeric / 100 end,
        stripe_tax_cad = case when p_tax_cents is null then null else p_tax_cents::numeric / 100 end,
        stripe_total_cad = case when p_total_cents is null then null else p_total_cents::numeric / 100 end,
        stripe_currency = lower(coalesce(p_currency, 'cad')),
        stripe_upgrade_checkout_session_id = null,
        stripe_upgrade_attempt = stripe_upgrade_attempt + 1,
        stripe_upgrade_from_price_cad = null,
        stripe_upgrade_target_lesson_id = null,
        stripe_upgrade_target_lesson_name = null,
        stripe_upgrade_target_duration_min = null,
        stripe_upgrade_target_price_cad = null,
        stripe_upgrade_amount_cad = null,
        updated_at = now()
    where b.package_id = v_anchor.package_id
      and b.payment_status = 'paid'
      and b.status in ('confirmed', 'rescheduled');
  elsif p_event_type = 'expired' then
    update public.bookings
    set stripe_upgrade_checkout_session_id = null,
        stripe_upgrade_attempt = stripe_upgrade_attempt + 1,
        updated_at = now()
    where id = p_booking_id and stripe_upgrade_checkout_session_id = p_session_id;
  else
    raise exception 'Unsupported Stripe upgrade event kind: %', p_event_type;
  end if;
  return true;
end;
$$;
revoke execute on function public.record_stripe_upgrade_checkout_event(text, text, uuid, text, text, text, text, bigint, bigint, bigint, text, text, text, integer, numeric, numeric) from public, anon, authenticated;
grant execute on function public.record_stripe_upgrade_checkout_event(text, text, uuid, text, text, text, text, bigint, bigint, bigint, text, text, text, integer, numeric, numeric) to service_role;

create or replace function public.set_booking_package_upgrade_checkout(
  p_booking_id uuid,
  p_session_id text,
  p_target_lesson_id text,
  p_target_lesson_name text,
  p_target_duration_min integer,
  p_target_price_cad numeric,
  p_from_price_cad numeric,
  p_amount_cad numeric,
  p_expected_starts_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_anchor public.bookings%rowtype;
  v_count integer;
  v_eligible integer;
begin
  select * into v_anchor from public.bookings where id = p_booking_id for update;
  if not found or v_anchor.session_index <> 1 or
     v_anchor.starts_at <> p_expected_starts_at or
     v_anchor.package_price_cad <> p_from_price_cad or
     v_anchor.payment_status <> 'paid' or
     v_anchor.status not in ('confirmed', 'rescheduled') or
     v_anchor.stripe_upgrade_checkout_session_id is not null or
     p_target_price_cad <= p_from_price_cad or p_target_duration_min < 15 or
     p_amount_cad <> round((p_target_price_cad - p_from_price_cad) * 100) / 100 then
    return false;
  end if;
  select count(*), count(*) filter (where payment_status = 'paid' and status in ('confirmed','rescheduled'))
    into v_count, v_eligible
  from public.bookings where package_id = v_anchor.package_id;
  if v_count <> v_anchor.session_count or v_eligible <> v_count then return false; end if;

  update public.bookings set
    stripe_upgrade_checkout_session_id = p_session_id,
    stripe_upgrade_from_price_cad = p_from_price_cad,
    stripe_upgrade_target_lesson_id = p_target_lesson_id,
    stripe_upgrade_target_lesson_name = p_target_lesson_name,
    stripe_upgrade_target_duration_min = p_target_duration_min,
    stripe_upgrade_target_price_cad = p_target_price_cad,
    stripe_upgrade_amount_cad = p_amount_cad
  where id = p_booking_id;
  return true;
end;
$$;
revoke execute on function public.set_booking_package_upgrade_checkout(uuid, text, text, text, integer, numeric, numeric, numeric, timestamptz) from public, anon, authenticated;
grant execute on function public.set_booking_package_upgrade_checkout(uuid, text, text, text, integer, numeric, numeric, numeric, timestamptz) to service_role;
