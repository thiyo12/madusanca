-- Defense in depth: a race with cancellation/rescheduling must not apply an
-- upgrade to an inactive booking, and only internally consistent CAD totals pass.
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
set search_path = public
as $$
declare
  v_updated integer;
begin
  if p_event_type = 'paid' and (
    lower(coalesce(p_currency, '')) <> 'cad' or
    p_subtotal_cents is null or p_tax_cents is null or p_total_cents is null or
    p_subtotal_cents < 0 or p_tax_cents < 0 or
    p_total_cents <> p_subtotal_cents + p_tax_cents
  ) then
    raise exception 'Invalid CAD upgrade payment totals';
  end if;

  insert into public.stripe_webhook_events (event_id, event_type)
  values (p_event_id, 'upgrade_' || p_event_type)
  on conflict (event_id) do nothing;
  if not found then return false; end if;

  if p_event_type = 'paid' then
    update public.bookings
    set lesson_id = p_target_lesson_id,
        lesson_name = p_target_lesson_name,
        duration_min = p_target_duration_min,
        price_cad = p_target_price_cad,
        stripe_payment_intent_id = p_payment_intent_id,
        stripe_invoice_id = p_invoice_id,
        stripe_invoice_url = p_invoice_url,
        stripe_subtotal_cad = p_subtotal_cents::numeric / 100,
        stripe_tax_cad = p_tax_cents::numeric / 100,
        stripe_total_cad = p_total_cents::numeric / 100,
        stripe_currency = 'cad',
        stripe_upgrade_checkout_session_id = null,
        stripe_upgrade_attempt = stripe_upgrade_attempt + 1,
        updated_at = now()
    where id = p_booking_id
      and stripe_upgrade_checkout_session_id = p_session_id
      and payment_status = 'paid'
      and status in ('confirmed', 'rescheduled')
      and stripe_upgrade_from_price_cad = p_from_price_cad
      and stripe_upgrade_target_lesson_id = p_target_lesson_id
      and stripe_upgrade_target_lesson_name = p_target_lesson_name
      and stripe_upgrade_target_duration_min = p_target_duration_min
       and stripe_upgrade_target_price_cad = p_target_price_cad
       and p_target_price_cad > p_from_price_cad
       and p_subtotal_cents = round(stripe_upgrade_amount_cad * 100)::bigint;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'Upgrade payment no longer matches an active booking';
    end if;
  elsif p_event_type = 'expired' then
    update public.bookings
    set stripe_upgrade_checkout_session_id = null,
        stripe_upgrade_attempt = stripe_upgrade_attempt + 1,
        updated_at = now()
    where id = p_booking_id and stripe_upgrade_checkout_session_id = p_session_id;
  else
    raise exception 'Unsupported Stripe upgrade event kind';
  end if;
  return true;
end;
$$;

revoke execute on function public.record_stripe_upgrade_checkout_event(text, text, uuid, text, text, text, text, bigint, bigint, bigint, text, text, text, integer, numeric, numeric) from public, anon, authenticated;
grant execute on function public.record_stripe_upgrade_checkout_event(text, text, uuid, text, text, text, text, bigint, bigint, bigint, text, text, text, integer, numeric, numeric) to service_role;
