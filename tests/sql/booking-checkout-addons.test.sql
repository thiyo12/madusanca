begin;

do $$
declare
  v_booking_id uuid;
  v_purchase_id uuid;
  v_session_id text := 'cs_addon_test_' || replace(gen_random_uuid()::text, '-', '');
  v_start timestamptz := (date_trunc('week', now() at time zone 'America/Vancouver') + interval '7 days 10 hours') at time zone 'America/Vancouver';
  v_result boolean;
  v_balance integer;
  v_purchase_status text;
  v_booking_status text;
  v_expiry_booking_id uuid;
  v_expiry_purchase_id uuid;
  v_expiry_start timestamptz := (date_trunc('week', now() at time zone 'America/Vancouver') + interval '14 days 10 hours') at time zone 'America/Vancouver';
  v_expiry_session text := 'cs_addon_expire_' || replace(gen_random_uuid()::text, '-', '');
  v_retry_session text := 'cs_addon_retry_' || replace(gen_random_uuid()::text, '-', '');
begin
  insert into public.bookings (
    reference, lesson_id, lesson_name, duration_min, price_cad,
    starts_at, ends_at, student_name, email, phone, status, payment_status
  ) values (
    'WDA-T-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
    '90-minute-lesson', '90-Minute Lesson', 90, 90,
    v_start, v_start + interval '90 minutes', 'SQL Add-on Test',
    'addon-test@example.invalid', '6045550100', 'pending_payment', 'due'
  ) returning id into v_booking_id;

  v_result := public.set_booking_checkout_session_with_addons(
    v_booking_id, v_session_id, now() + interval '31 minutes', v_start,
    array['five-lesson-pack']::text[]
  );
  if not v_result then raise exception 'Expected the add-on Checkout Session to be saved'; end if;

  -- Retrying the same storage operation must not create another entitlement.
  v_result := public.set_booking_checkout_session_with_addons(
    v_booking_id, v_session_id, now() + interval '31 minutes', v_start,
    array['five-lesson-pack']::text[]
  );
  if not v_result then raise exception 'Expected idempotent Checkout Session persistence'; end if;

  select i.purchase_id into v_purchase_id
  from public.booking_checkout_addon_attempts a
  join public.booking_checkout_addon_items i on i.attempt_id = a.id
  where a.stripe_checkout_session_id = v_session_id;
  if v_purchase_id is null then raise exception 'Expected the add-on purchase snapshot'; end if;

  v_result := public.record_stripe_checkout_event(
    'evt_addon_bad_total', 'paid', v_booking_id, v_session_id,
    'pi_addon_test', null, null, 9000, 450, 9450, 'cad'
  );
  if v_result then raise exception 'Mismatched Checkout subtotal must not fulfill'; end if;

  v_result := public.record_stripe_checkout_event(
    'evt_addon_paid', 'paid', v_booking_id, v_session_id,
    'pi_addon_test', null, null, 54000, 2700, 56700, 'cad'
  );
  if not v_result then raise exception 'Expected verified Checkout payment fulfillment'; end if;

  v_result := public.record_stripe_checkout_event(
    'evt_addon_paid_duplicate', 'paid', v_booking_id, v_session_id,
    'pi_addon_test', null, null, 54000, 2700, 56700, 'cad'
  );
  select payment_status into v_purchase_status from public.package_purchases where id = v_purchase_id;
  select coalesce(sum(quantity_delta), 0) into v_balance from public.package_credit_events where purchase_id = v_purchase_id;
  select status into v_booking_status from public.bookings where id = v_booking_id;
  if v_purchase_status <> 'paid' or v_balance <> 5 or v_booking_status <> 'confirmed' then
    raise exception 'Unexpected fulfilled booking/add-on state: purchase %, balance %, booking %', v_purchase_status, v_balance, v_booking_status;
  end if;
  if (select count(*) from public.package_credit_events where purchase_id = v_purchase_id and event_type = 'grant') <> 1 then
    raise exception 'Duplicate event must not grant duplicate credits';
  end if;

  insert into public.bookings (
    reference, lesson_id, lesson_name, duration_min, price_cad,
    starts_at, ends_at, student_name, email, phone, status, payment_status
  ) values (
    'WDA-T-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
    '90-minute-lesson', '90-Minute Lesson', 90, 90,
    v_expiry_start, v_expiry_start + interval '90 minutes', 'SQL Add-on Retry Test',
    'addon-retry@example.invalid', '6045550101', 'pending_payment', 'due'
  ) returning id into v_expiry_booking_id;
  v_result := public.set_booking_checkout_session_with_addons(
    v_expiry_booking_id, v_expiry_session, now() + interval '31 minutes', v_expiry_start,
    array['five-lesson-pack']::text[]
  );
  if not v_result then raise exception 'Expected expired test Checkout Session to be saved'; end if;
  select i.purchase_id into v_expiry_purchase_id
  from public.booking_checkout_addon_attempts a
  join public.booking_checkout_addon_items i on i.attempt_id = a.id
  where a.stripe_checkout_session_id = v_expiry_session;
  v_result := public.record_stripe_checkout_event(
    'evt_addon_expired', 'expired', v_expiry_booking_id, v_expiry_session
  );
  if not v_result then raise exception 'Expected expired Checkout reconciliation'; end if;
  if (select payment_status from public.package_purchases where id = v_expiry_purchase_id) <> 'failed' then
    raise exception 'Expired add-on purchase must not remain pending';
  end if;
  v_result := public.set_booking_checkout_session_with_addons(
    v_expiry_booking_id, v_retry_session, now() + interval '31 minutes', v_expiry_start,
    array['five-lesson-pack']::text[]
  );
  if not v_result then raise exception 'Expected retry Checkout Session after expiry'; end if;
  if (select count(*) from public.booking_checkout_addon_attempts where booking_id = v_expiry_booking_id) <> 2 then
    raise exception 'Retry must create a new independently tracked add-on attempt';
  end if;
end;
$$;

rollback;
