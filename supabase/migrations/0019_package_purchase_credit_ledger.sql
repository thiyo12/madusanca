-- Add an independent purchase and append-only credit ledger. Legacy booking
-- packages are snapshotted without rewriting bookings or Stripe history.
create table if not exists public.package_purchases (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  legacy_package_id uuid unique,
  student_name text not null,
  email text not null,
  phone text not null default '',
  notes text not null default '',
  lesson_id text not null,
  lesson_name text not null,
  duration_min integer not null check (duration_min > 0),
  credits_purchased integer not null check (credits_purchased between 1 and 20),
  amount_cad numeric(10,2) not null check (amount_cad >= 0),
  currency text not null default 'cad' check (currency = 'cad'),
  payment_status text not null check (payment_status in ('pending', 'paid', 'refunded', 'waived', 'failed')),
  purchased_at timestamptz,
  valid_until timestamptz,
  stripe_checkout_session_id text unique,
  stripe_checkout_expires_at timestamptz,
  stripe_checkout_attempt integer not null default 0 check (stripe_checkout_attempt >= 0),
  stripe_payment_intent_id text,
  stripe_invoice_id text,
  stripe_invoice_url text,
  stripe_subtotal_cad numeric(10,2),
  stripe_tax_cad numeric(10,2),
  stripe_total_cad numeric(10,2),
  source text not null default 'new' check (source in ('new', 'legacy_backfill')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (payment_status <> 'paid' or purchased_at is not null or source = 'legacy_backfill'),
  check (valid_until is null or purchased_at is not null)
);

create index if not exists package_purchases_email_idx
  on public.package_purchases (lower(email), created_at desc);
create index if not exists package_purchases_expiry_idx
  on public.package_purchases (valid_until)
  where payment_status = 'paid' and valid_until is not null;

create table if not exists public.package_credit_events (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.package_purchases(id),
  booking_id uuid references public.bookings(id),
  event_type text not null check (event_type in ('grant', 'redeem', 'refund', 'expire', 'admin_adjustment')),
  quantity_delta integer not null check (quantity_delta <> 0),
  source_key text not null unique,
  actor_id uuid references auth.users(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  check (
    (event_type in ('grant', 'admin_adjustment') and quantity_delta > 0) or
    (event_type in ('redeem', 'refund', 'expire') and quantity_delta < 0)
  )
);

create index if not exists package_credit_events_purchase_idx
  on public.package_credit_events (purchase_id, created_at, id);
create unique index if not exists package_credit_events_booking_redemption_idx
  on public.package_credit_events (booking_id)
  where event_type = 'redeem' and booking_id is not null;

-- Opaque tokens are the same access pattern as booking manage tokens, scoped
-- to a purchase until its first session is scheduled.
create table if not exists public.package_purchase_tokens (
  token_hash text primary key check (length(token_hash) = 64),
  purchase_id uuid not null references public.package_purchases(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists package_purchase_tokens_purchase_idx
  on public.package_purchase_tokens (purchase_id);

alter table public.package_purchases enable row level security;
alter table public.package_credit_events enable row level security;
alter table public.package_purchase_tokens enable row level security;
revoke all on public.package_purchases, public.package_credit_events, public.package_purchase_tokens from public, anon, authenticated;
grant select, insert, update, delete on public.package_purchases, public.package_credit_events, public.package_purchase_tokens to service_role;

-- Idempotently backfill one purchase for each existing package. Legacy paid
-- packages have no trustworthy historical payment timestamp in the current
-- schema, so purchased_at/valid_until are deliberately null and old credits do
-- not silently acquire a newly invented expiry date. Their original Stripe and
-- booking rows remain authoritative historical evidence.
insert into public.package_purchases (
  reference, legacy_package_id, student_name, email, phone, notes, lesson_id, lesson_name,
  duration_min, credits_purchased, amount_cad, currency, payment_status,
  purchased_at, valid_until, stripe_checkout_session_id,
  stripe_payment_intent_id, stripe_invoice_id, stripe_invoice_url,
  source, created_at, updated_at
)
select
  'LEGACY-' || anchor.reference,
  anchor.package_id,
  anchor.student_name,
  anchor.email,
  anchor.phone,
  anchor.notes,
  anchor.lesson_id,
  anchor.lesson_name,
  anchor.duration_min,
  anchor.session_count,
  anchor.package_price_cad,
  coalesce(anchor.stripe_currency, 'cad'),
  case anchor.payment_status
    when 'paid' then 'paid'
    when 'refunded' then 'refunded'
    when 'waived' then 'waived'
    else 'pending'
  end,
  null,
  null,
  anchor.stripe_checkout_session_id,
  anchor.stripe_payment_intent_id,
  anchor.stripe_invoice_id,
  anchor.stripe_invoice_url,
  'legacy_backfill',
  anchor.created_at,
  anchor.updated_at
from public.bookings anchor
where anchor.session_index = 1
on conflict (legacy_package_id) do nothing;

-- Grant the historical paid package quantity once, then redeem one credit for
-- every existing scheduled session (including completed/cancelled history).
-- This makes the new balance reflect what remains without altering old rows.
insert into public.package_credit_events (purchase_id, event_type, quantity_delta, source_key, note)
select p.id, 'grant', p.credits_purchased,
  'legacy-grant:' || p.legacy_package_id::text,
  'Historical paid package entitlement; historical payment date was not stored.'
from public.package_purchases p
where p.source = 'legacy_backfill' and p.payment_status = 'paid'
on conflict (source_key) do nothing;

insert into public.package_credit_events (purchase_id, booking_id, event_type, quantity_delta, source_key, note)
select p.id, b.id, 'redeem', -1,
  'legacy-redeem:' || b.id::text,
  'Historical scheduled session; retained as a credit redemption.'
from public.package_purchases p
join public.bookings b on b.package_id = p.legacy_package_id
where p.source = 'legacy_backfill' and p.payment_status = 'paid'
on conflict (source_key) do nothing;

-- Keep the package snapshot immutable while allowing operational payment fields
-- to change. Credit events are an audit ledger: corrections are new events.
create or replace function public.guard_package_purchase_snapshot()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if row(new.reference, new.legacy_package_id, new.student_name, new.email, new.phone,
         new.notes, new.lesson_id, new.lesson_name, new.duration_min,
         new.credits_purchased, new.amount_cad, new.currency, new.source,
         new.created_at)
     is distinct from
     row(old.reference, old.legacy_package_id, old.student_name, old.email, old.phone,
         old.notes, old.lesson_id, old.lesson_name, old.duration_min,
         old.credits_purchased, old.amount_cad, old.currency, old.source,
         old.created_at) then
    raise exception 'Package purchase snapshots are immutable';
  end if;
  return new;
end;
$$;
drop trigger if exists package_purchase_snapshot_guard on public.package_purchases;
create trigger package_purchase_snapshot_guard
before update on public.package_purchases
for each row execute function public.guard_package_purchase_snapshot();

create or replace function public.reject_package_credit_event_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'Package credit events are append-only';
end;
$$;
drop trigger if exists package_credit_events_append_only on public.package_credit_events;
create trigger package_credit_events_append_only
before update or delete on public.package_credit_events
for each row execute function public.reject_package_credit_event_mutation();

-- A verified Stripe webhook calls this RPC only after the application has
-- retrieved the stored Checkout session and validated its metadata and totals.
-- The RPC locks the purchase, records the webhook idempotently, starts the
-- six-calendar-month validity period at payment time, and grants credits once.
create or replace function public.fulfill_package_purchase_payment(
  p_event_id text,
  p_purchase_id uuid,
  p_session_id text,
  p_payment_intent_id text,
  p_invoice_id text,
  p_invoice_url text,
  p_subtotal_cents bigint,
  p_tax_cents bigint,
  p_total_cents bigint,
  p_currency text,
  p_paid_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_purchase public.package_purchases%rowtype;
  v_paid_at timestamptz;
  v_valid_until timestamptz;
begin
  select * into v_purchase
  from public.package_purchases
  where id = p_purchase_id
  for update;
  if not found or v_purchase.source <> 'new' or
     v_purchase.stripe_checkout_session_id is distinct from p_session_id or
     v_purchase.payment_status not in ('pending', 'paid') or
     p_paid_at is null or p_paid_at > now() + interval '5 minutes' or
     lower(coalesce(p_currency, '')) <> 'cad' or
     p_subtotal_cents is distinct from round(v_purchase.amount_cad * 100)::bigint or
     p_tax_cents is null or p_tax_cents < 0 or p_total_cents is distinct from p_subtotal_cents + p_tax_cents then
    return false;
  end if;

  insert into public.stripe_webhook_events (event_id, event_type)
  values (p_event_id, 'package_purchase_paid')
  on conflict (event_id) do nothing;
  if not found then return false; end if;

  v_paid_at := coalesce(v_purchase.purchased_at, p_paid_at);
  v_valid_until := coalesce(v_purchase.valid_until,
    (v_paid_at at time zone 'America/Vancouver' + interval '6 months') at time zone 'America/Vancouver');

  update public.package_purchases
  set payment_status = 'paid',
      purchased_at = v_paid_at,
      valid_until = v_valid_until,
      stripe_payment_intent_id = p_payment_intent_id,
      stripe_invoice_id = p_invoice_id,
      stripe_invoice_url = p_invoice_url,
      stripe_subtotal_cad = p_subtotal_cents::numeric / 100,
      stripe_tax_cad = p_tax_cents::numeric / 100,
      stripe_total_cad = p_total_cents::numeric / 100,
      updated_at = now()
  where id = p_purchase_id;

  insert into public.package_credit_events (purchase_id, event_type, quantity_delta, source_key, note)
  values (p_purchase_id, 'grant', v_purchase.credits_purchased,
    'stripe-purchase-grant:' || p_purchase_id::text,
    'Credits granted after verified Stripe payment.')
  on conflict (source_key) do nothing;
  return true;
end;
$$;

revoke all on function public.fulfill_package_purchase_payment(text, uuid, text, text, text, text, bigint, bigint, bigint, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.fulfill_package_purchase_payment(text, uuid, text, text, text, text, bigint, bigint, bigint, text, timestamptz)
  to service_role;

create or replace function public.expire_package_purchase_checkout(
  p_event_id text,
  p_purchase_id uuid,
  p_session_id text
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_purchase public.package_purchases%rowtype;
begin
  select * into v_purchase from public.package_purchases
  where id = p_purchase_id for update;
  if not found or v_purchase.source <> 'new' or
     v_purchase.payment_status <> 'pending' or
     v_purchase.stripe_checkout_session_id is distinct from p_session_id then
    return false;
  end if;
  insert into public.stripe_webhook_events (event_id, event_type)
  values (p_event_id, 'package_purchase_expired')
  on conflict (event_id) do nothing;
  if not found then return false; end if;
  update public.package_purchases
  set payment_status = 'failed', stripe_checkout_session_id = null,
      stripe_checkout_expires_at = null,
      stripe_checkout_attempt = stripe_checkout_attempt + 1,
      updated_at = now()
  where id = p_purchase_id;
  return true;
end;
$$;
revoke all on function public.expire_package_purchase_checkout(text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.expire_package_purchase_checkout(text, uuid, text)
  to service_role;

-- Direct access remains service-role-only; anon/authenticated receive no policies.
