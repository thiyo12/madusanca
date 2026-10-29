-- Stripe one-time Checkout sessions, paid invoices, tax totals and webhook
-- idempotency. Run after migrations 0001–0005.

alter table public.bookings
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_checkout_attempt integer not null default 0,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists stripe_invoice_id text,
  add column if not exists stripe_invoice_url text,
  add column if not exists stripe_subtotal_cad numeric(10, 2),
  add column if not exists stripe_tax_cad numeric(10, 2),
  add column if not exists stripe_total_cad numeric(10, 2),
  add column if not exists stripe_currency text not null default 'cad';

alter table public.bookings drop constraint if exists bookings_status_check;
alter table public.bookings
  add constraint bookings_status_check
  check (status in ('pending_payment', 'confirmed', 'rescheduled', 'cancelled', 'completed'));

create unique index if not exists bookings_stripe_checkout_session_id_idx
  on public.bookings (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  created_at timestamptz not null default now()
);

alter table public.stripe_webhook_events enable row level security;
-- No policies: webhook event records are only touched by the service role.

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
set search_path = public
as $$
begin
  insert into public.stripe_webhook_events (event_id, event_type)
  values (p_event_id, p_event_type)
  on conflict (event_id) do nothing;
  if not found then
    return false;
  end if;

  if p_event_type = 'paid' then
    update public.bookings
    set payment_status = 'paid',
        status = case when status = 'pending_payment' then 'confirmed' else status end,
        stripe_checkout_session_id = p_session_id,
        stripe_payment_intent_id = p_payment_intent_id,
        stripe_invoice_id = p_invoice_id,
        stripe_invoice_url = p_invoice_url,
        stripe_subtotal_cad = case when p_subtotal_cents is null then null else p_subtotal_cents::numeric / 100 end,
        stripe_tax_cad = case when p_tax_cents is null then null else p_tax_cents::numeric / 100 end,
        stripe_total_cad = case when p_total_cents is null then null else p_total_cents::numeric / 100 end,
        stripe_currency = lower(coalesce(p_currency, 'cad')),
        updated_at = now()
    where id = p_booking_id and payment_status <> 'refunded';
  elsif p_event_type = 'expired' then
    update public.bookings
    set stripe_checkout_session_id = null,
        stripe_checkout_attempt = stripe_checkout_attempt + 1,
        updated_at = now()
    where id = p_booking_id
      and stripe_checkout_session_id = p_session_id
      and payment_status = 'due';
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
