-- Wisdom Driving Academy — initial booking schema (Phase 3)
-- Run in the Supabase SQL editor, or via `supabase db push`.
--
-- Security posture:
--   * RLS enabled with NO policies on every table (deny-all for anon/authenticated).
--   * All writes happen through SECURITY DEFINER RPCs called only from the
--     Next.js server with the service-role key.
--   * Manage links store only SHA-256 hashes of the opaque token.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'admin' check (role in ('admin', 'instructor')),
  full_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  lesson_id text not null,
  lesson_name text not null,
  duration_min integer not null check (duration_min > 0),
  price_cad numeric(10, 2) not null default 0,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  student_name text not null,
  email text not null,
  phone text not null default '',
  notes text not null default '',
  status text not null default 'confirmed'
    check (status in ('confirmed', 'rescheduled', 'cancelled', 'completed')),
  payment_status text not null default 'due'
    check (payment_status in ('due', 'paid', 'refunded', 'waived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index if not exists bookings_starts_at_idx on public.bookings (starts_at);
create index if not exists bookings_status_starts_at_idx on public.bookings (status, starts_at);
create index if not exists bookings_email_idx on public.bookings (email);

create table if not exists public.booking_tokens (
  token_hash text primary key,
  booking_id uuid not null references public.bookings (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists booking_tokens_booking_id_idx
  on public.booking_tokens (booking_id);

create table if not exists public.availability_rules (
  weekday smallint primary key check (weekday between 0 and 6),
  start_min integer not null check (start_min between 0 and 1439),
  end_min integer not null check (end_min between 1 and 1440),
  check (end_min > start_min)
);

create table if not exists public.blackout_dates (
  date date primary key,
  reason text
);

-- ---------------------------------------------------------------------------
-- Seed: Mon–Sat 09:00–18:00 (Sat ends 17:00), Sunday closed
-- ---------------------------------------------------------------------------

insert into public.availability_rules (weekday, start_min, end_min) values
  (1, 540, 1080),
  (2, 540, 1080),
  (3, 540, 1080),
  (4, 540, 1080),
  (5, 540, 1080),
  (6, 540, 1020)
on conflict (weekday) do nothing;

-- ---------------------------------------------------------------------------
-- RLS: deny-all for client roles; service role bypasses RLS.
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_tokens enable row level security;
alter table public.availability_rules enable row level security;
alter table public.blackout_dates enable row level security;

-- No policies on purpose: anon/authenticated can read nothing, write nothing.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.booking_overlaps(
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_exclude_booking_id uuid default null
) returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.bookings b
    where b.status in ('confirmed', 'rescheduled')
      and (p_exclude_booking_id is null or b.id <> p_exclude_booking_id)
      and b.starts_at < p_ends_at
      and p_starts_at < b.ends_at
  );
$$;

-- Serialises concurrent creates per UTC calendar day (cheap, no row to lock).
create or replace function public.lock_booking_day(p_starts_at timestamptz)
returns void
language plpgsql
as $$
begin
  perform pg_advisory_xact_lock(hashtext('booking:' || (p_starts_at at time zone 'UTC')::date::text));
end;
$$;

create or replace function public.new_reference()
returns text
language plpgsql
as $$
declare
  candidate text;
begin
  loop
    candidate := 'WDA-' || upper(substr(encode(extensions.gen_random_bytes(4), 'hex'), 1, 6));
    exit when not exists (select 1 from public.bookings b where b.reference = candidate);
  end loop;
  return candidate;
end;
$$;

-- ---------------------------------------------------------------------------
-- Atomic RPCs
-- ---------------------------------------------------------------------------

create or replace function public.create_booking(
  p_token_hash text,
  p_token_expires_at timestamptz,
  p_lesson_id text,
  p_lesson_name text,
  p_duration_min integer,
  p_price_cad numeric,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_student_name text,
  p_email text,
  p_phone text,
  p_notes text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings;
begin
  if p_token_hash is null or length(p_token_hash) < 32 then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  perform public.lock_booking_day(p_starts_at);

  if public.booking_overlaps(p_starts_at, p_ends_at) then
    return jsonb_build_object('ok', false, 'error', 'conflict');
  end if;

  insert into public.bookings (
    reference, lesson_id, lesson_name, duration_min, price_cad,
    starts_at, ends_at, student_name, email, phone, notes, status
  ) values (
    public.new_reference(), p_lesson_id, p_lesson_name, p_duration_min, p_price_cad,
    p_starts_at, p_ends_at, p_student_name, p_email, p_phone, p_notes, 'confirmed'
  ) returning * into v_booking;

  insert into public.booking_tokens (token_hash, booking_id, expires_at)
  values (p_token_hash, v_booking.id, p_token_expires_at);

  return jsonb_build_object('ok', true, 'record', to_jsonb(v_booking));
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'conflict');
end;
$$;

create or replace function public.get_booking_by_token(p_token_hash text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ok', true,
    'record', to_jsonb(b),
    'expires_at', t.expires_at
  )
  from public.booking_tokens t
  join public.bookings b on b.id = t.booking_id
  where t.token_hash = p_token_hash
    and t.expires_at > now()
  limit 1;
$$;

create or replace function public.reschedule_booking_by_token(
  p_token_hash text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_new_token_hash text,
  p_new_token_expires_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings;
begin
  select b.* into v_booking
  from public.booking_tokens t
  join public.bookings b on b.id = t.booking_id
  where t.token_hash = p_token_hash
    and t.expires_at > now()
  for update of b;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;
  if v_booking.status in ('cancelled', 'completed') then
    return jsonb_build_object('ok', false, 'error', 'not_modifiable');
  end if;

  perform public.lock_booking_day(p_starts_at);

  if public.booking_overlaps(p_starts_at, p_ends_at, v_booking.id) then
    return jsonb_build_object('ok', false, 'error', 'conflict');
  end if;

  update public.bookings
  set starts_at = p_starts_at,
      ends_at = p_ends_at,
      status = 'rescheduled',
      updated_at = now()
  where id = v_booking.id
  returning * into v_booking;

  -- Token rotation: the emailed link stops working after one reschedule.
  delete from public.booking_tokens where booking_id = v_booking.id;
  insert into public.booking_tokens (token_hash, booking_id, expires_at)
  values (p_new_token_hash, v_booking.id, p_new_token_expires_at);

  return jsonb_build_object('ok', true, 'record', to_jsonb(v_booking));
end;
$$;

create or replace function public.cancel_booking_by_token(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings;
begin
  select b.* into v_booking
  from public.booking_tokens t
  join public.bookings b on b.id = t.booking_id
  where t.token_hash = p_token_hash
    and t.expires_at > now()
  for update of b;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;
  if v_booking.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'error', 'not_modifiable');
  end if;

  update public.bookings
  set status = 'cancelled',
      updated_at = now()
  where id = v_booking.id
  returning * into v_booking;

  return jsonb_build_object('ok', true, 'record', to_jsonb(v_booking));
end;
$$;

-- Only the service role may execute these.
revoke execute on function public.create_booking(text, timestamptz, text, text, integer, numeric, timestamptz, timestamptz, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.get_booking_by_token(text) from public, anon, authenticated;
revoke execute on function public.reschedule_booking_by_token(text, timestamptz, timestamptz, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.cancel_booking_by_token(text) from public, anon, authenticated;
