begin;

do $$
declare
  v_booking_id uuid;
  v_purchase_id uuid;
  v_session_id text := 'cs_addon_test_' || replace(gen_random_uuid()::text, '-', '');
  v_start timestamptz := (date_trunc('week', now() at time zone 'America/Vancouver') + interval '7 days 9 hours') at time zone 'America/Vancouver';
  v_result boolean;
  v_balance integer;
  v_credits integer;
  v_addon_amount numeric;
  v_purchase_status text;
  v_booking_status text;
  v_expiry_booking_id uuid;
  v_expiry_purchase_id uuid;
  v_expiry_start timestamptz := (date_trunc('week', now() at time zone 'America/Vancouver') + interval '14 days 9 hours') at time zone 'America/Vancouver';
  v_expiry_session text := 'cs_addon_expire_' || replace(gen_random_uuid()::text, '-', '');
  v_retry_session text := 'cs_addon_retry_' || replace(gen_random_uuid()::text, '-', '');
  v_six_month_start timestamptz := (date_trunc('week', now() at time zone 'America/Vancouver') + interval '5 months 7 days 9 hours') at time zone 'America/Vancouver';
  v_six_month_starts timestamptz[];
  v_starts timestamptz[];
  v_bundle jsonb;
  v_bundle_result jsonb;
begin
  v_starts := array[
    v_start + interval '2 hours', v_start + interval '4 hours', v_start + interval '6 hours',
    v_start + interval '24 hours', v_start + interval '26 hours', v_start + interval '28 hours', v_start + interval '30 hours',
    v_start + interval '48 hours', v_start + interval '50 hours', v_start + interval '52 hours'
  ];
  v_bundle := jsonb_build_array(
    jsonb_build_object('lessonId', '90-minute-lesson', 'quantity', 1, 'startsAt', array[v_start]),
    jsonb_build_object('lessonId', 'five-lesson-pack', 'quantity', 2, 'startsAt', v_starts)
  );
  v_bundle_result := public.create_booking_bundle_with_student_details(
    repeat('a', 64), now() + interval '1 day', v_bundle,
    'SQL Add-on Test', 'addon-test@example.invalid', '6045550100', '',
    date '1990-01-01', 'prefer_not_to_say', 'BC123456'
  );
  if not coalesce((v_bundle_result->>'ok')::boolean, false) then
    raise exception 'Expected atomic bundle scheduling, got %', v_bundle_result;
  end if;
  v_booking_id := (v_bundle_result->'records'->0->>'id')::uuid;
  if not exists (
    select 1 from public.booking_student_details
    where booking_id = v_booking_id and date_of_birth = date '1990-01-01'
      and gender = 'prefer_not_to_say' and license_number = 'BC123456'
  ) then
    raise exception 'Student identity details should be stored on the private anchor record';
  end if;

  v_result := public.set_booking_checkout_session_with_addons(
    v_booking_id, v_session_id, now() + interval '31 minutes', v_start,
    '[{"lessonId":"five-lesson-pack","quantity":2}]'::jsonb
  );
  if not v_result then raise exception 'Expected the add-on Checkout Session to be saved'; end if;

  -- Retrying the same storage operation must not create another entitlement.
  v_result := public.set_booking_checkout_session_with_addons(
    v_booking_id, v_session_id, now() + interval '31 minutes', v_start,
    '[{"lessonId":"five-lesson-pack","quantity":2}]'::jsonb
  );
  if not v_result then raise exception 'Expected idempotent Checkout Session persistence'; end if;

  select i.purchase_id into v_purchase_id
  from public.booking_checkout_addon_attempts a
  join public.booking_checkout_addon_items i on i.attempt_id = a.id
  where a.stripe_checkout_session_id = v_session_id;
  if v_purchase_id is null then raise exception 'Expected the add-on purchase snapshot'; end if;
  select credits_purchased, amount_cad into v_credits, v_addon_amount
  from public.package_purchases where id = v_purchase_id;
  if v_credits <> 10 or v_addon_amount <> 900 or
     (select count(*) from public.booking_checkout_addon_items where attempt_id = (
       select id from public.booking_checkout_addon_attempts where stripe_checkout_session_id = v_session_id
     )) <> 1 then
    raise exception 'Quantity must be grouped into one correctly priced package purchase';
  end if;

  v_result := public.record_stripe_checkout_event(
    'evt_addon_bad_total', 'paid', v_booking_id, v_session_id,
    'pi_addon_test', null, null, 9000, 450, 9450, 'cad'
  );
  if v_result then raise exception 'Mismatched Checkout subtotal must not fulfill'; end if;

  v_result := public.record_stripe_checkout_event(
    'evt_addon_paid', 'paid', v_booking_id, v_session_id,
    'pi_addon_test', null, null, 99000, 4950, 103950, 'cad'
  );
  if not v_result then raise exception 'Expected verified Checkout payment fulfillment'; end if;

  v_result := public.record_stripe_checkout_event(
    'evt_addon_paid_duplicate', 'paid', v_booking_id, v_session_id,
    'pi_addon_test', null, null, 99000, 4950, 103950, 'cad'
  );
  select payment_status into v_purchase_status from public.package_purchases where id = v_purchase_id;
  select coalesce(sum(quantity_delta), 0) into v_balance from public.package_credit_events where purchase_id = v_purchase_id;
  select status into v_booking_status from public.bookings where id = v_booking_id;
  if v_purchase_status <> 'paid' or v_balance <> 0 or v_booking_status <> 'confirmed' then
    raise exception 'Unexpected fulfilled booking/add-on state: purchase %, balance %, booking %', v_purchase_status, v_balance, v_booking_status;
  end if;
  if (select count(*) from public.package_credit_events where purchase_id = v_purchase_id and event_type = 'grant') <> 1 then
    raise exception 'Duplicate event must not grant duplicate lessons';
  end if;
  if (select count(*) from public.package_credit_events where purchase_id = v_purchase_id and event_type = 'redeem') <> 10 then
    raise exception 'Every scheduled add-on lesson must be linked to its paid package';
  end if;

  v_starts := array[
    v_expiry_start + interval '2 hours', v_expiry_start + interval '4 hours',
    v_expiry_start + interval '24 hours', v_expiry_start + interval '26 hours',
    v_expiry_start + interval '48 hours'
  ];
  v_bundle := jsonb_build_array(
    jsonb_build_object('lessonId', '90-minute-lesson', 'quantity', 1, 'startsAt', array[v_expiry_start]),
    jsonb_build_object('lessonId', 'five-lesson-pack', 'quantity', 1, 'startsAt', v_starts)
  );
  v_bundle_result := public.create_booking_bundle(
    repeat('b', 64), now() + interval '1 day', v_bundle,
    'SQL Add-on Retry Test', 'addon-retry@example.invalid', '6045550101', ''
  );
  if not coalesce((v_bundle_result->>'ok')::boolean, false) then
    raise exception 'Expected retry bundle scheduling, got %', v_bundle_result;
  end if;
  v_expiry_booking_id := (v_bundle_result->'records'->0->>'id')::uuid;
  v_result := public.set_booking_checkout_session_with_addons(
    v_expiry_booking_id, v_expiry_session, now() + interval '31 minutes', v_expiry_start,
    '[{"lessonId":"five-lesson-pack","quantity":1}]'::jsonb
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
    '[{"lessonId":"five-lesson-pack","quantity":1}]'::jsonb
  );
  if not v_result then raise exception 'Expected retry Checkout Session after expiry'; end if;
  if (select count(*) from public.booking_checkout_addon_attempts where booking_id = v_expiry_booking_id) <> 2 then
    raise exception 'Retry must create a new independently tracked add-on attempt';
  end if;

  select array_agg(v_six_month_start + (day_offset * interval '21 days') order by day_offset)
    into v_six_month_starts
  from generate_series(0, 7) as day_offset;
  v_bundle := jsonb_build_array(
    jsonb_build_object('lessonId', 'eight-lesson-pack', 'quantity', 1, 'startsAt', to_jsonb(v_six_month_starts))
  );
  v_bundle_result := public.create_booking_bundle_with_student_details(
    repeat('c', 64), now() + interval '1 day', v_bundle,
    'SQL Six Month Test', 'six-month-test@example.invalid', '6045550102', '',
    date '1990-01-01', 'prefer_not_to_say', 'BC123456'
  );
  if not coalesce((v_bundle_result->>'ok')::boolean, false) then
    raise exception 'Eight sessions spread over more than two months and within a six-month package window should be accepted, got %', v_bundle_result;
  end if;
end;
$$;

rollback;
