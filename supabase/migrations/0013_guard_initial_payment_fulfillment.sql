-- Enforce initial-payment/session binding and CAD totals inside the transaction,
-- not only in application code before calling the service-role RPC.
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
set search_path = public, extensions
as $$
declare
  v_updated integer;
begin
  if p_event_type = 'paid' then
    if lower(coalesce(p_currency, '')) <> 'cad' or
       p_subtotal_cents is null or p_tax_cents is null or p_total_cents is null or
       p_subtotal_cents < 0 or p_tax_cents < 0 or
       p_total_cents <> p_subtotal_cents + p_tax_cents then
      raise exception 'Invalid CAD checkout payment totals';
    end if;

    if not exists (
      select 1 from public.bookings b
      where b.id = p_booking_id
        and b.stripe_checkout_session_id = p_session_id
        and b.payment_status = 'due'
        and p_subtotal_cents = round(b.price_cad * 100)::bigint
    ) then
      raise exception 'Checkout session does not match the stored booking balance';
    end if;
  elsif p_event_type <> 'expired' then
    raise exception 'Unsupported Stripe checkout event kind';
  end if;

  insert into public.stripe_webhook_events(event_id, event_type)
  values (p_event_id, p_event_type)
  on conflict (event_id) do nothing;
  if not found then return false; end if;

  if p_event_type = 'paid' then
    update public.bookings set payment_status = 'paid',
      status = case when status = 'pending_payment' then 'confirmed' else status end,
      stripe_payment_intent_id = p_payment_intent_id,
      stripe_invoice_id = p_invoice_id,
      stripe_invoice_url = p_invoice_url,
      stripe_subtotal_cad = p_subtotal_cents::numeric / 100,
      stripe_tax_cad = p_tax_cents::numeric / 100,
      stripe_total_cad = p_total_cents::numeric / 100,
      stripe_currency = 'cad',
      stripe_checkout_expires_at = null,
      updated_at = now()
    where id = p_booking_id
      and stripe_checkout_session_id = p_session_id
       and payment_status = 'due'
       and p_subtotal_cents = round(price_cad * 100)::bigint;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'Checkout payment no longer matches a payable booking';
    end if;
  else
    update public.bookings set stripe_checkout_session_id = null,
      stripe_checkout_expires_at = case when status = 'pending_payment' then now() else null end,
      stripe_checkout_attempt = stripe_checkout_attempt + 1,
      updated_at = now()
    where id = p_booking_id
      and stripe_checkout_session_id = p_session_id
      and payment_status = 'due';
  end if;
  return true;
end;
$$;

revoke execute on function public.record_stripe_checkout_event(text, text, uuid, text, text, text, text, bigint, bigint, bigint, text) from public, anon, authenticated;
grant execute on function public.record_stripe_checkout_event(text, text, uuid, text, text, text, text, bigint, bigint, bigint, text) to service_role;
