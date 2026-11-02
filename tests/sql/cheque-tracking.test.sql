begin;

do $$
declare
  v_purchase_id uuid;
  v_balance integer;
begin
  insert into public.package_purchases (
    reference, student_name, email, phone, notes, lesson_id, lesson_name,
    duration_min, credits_purchased, amount_cad, currency, payment_status, source
  ) values (
    'WDA-CHEQUE-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
    'Cheque Test', 'cheque-test@example.invalid', '6045550199', '',
    'five-lesson-pack', '5-Lesson Pack', 90, 5, 450, 'cad', 'pending', 'new'
  ) returning id into v_purchase_id;

  if public.record_package_cheque(v_purchase_id, 'received', 'TEST-001') is distinct from v_purchase_id then
    raise exception 'Cheque receipt should update the purchase';
  end if;
  if (select payment_status from public.package_purchases where id = v_purchase_id) <> 'pending' then
    raise exception 'A received cheque must not activate paid credits';
  end if;

  perform public.record_package_cheque(v_purchase_id, 'cleared', 'TEST-001');
  perform public.record_package_cheque(v_purchase_id, 'cleared', 'TEST-001');
  select coalesce(sum(quantity_delta), 0) into v_balance from public.package_credit_events where purchase_id = v_purchase_id;
  if (select payment_status from public.package_purchases where id = v_purchase_id) <> 'paid' or v_balance <> 5 then
    raise exception 'Cleared cheque must activate exactly the purchased credits';
  end if;

  perform public.record_package_cheque(v_purchase_id, 'returned', 'TEST-001');
  select coalesce(sum(quantity_delta), 0) into v_balance from public.package_credit_events where purchase_id = v_purchase_id;
  if (select payment_status from public.package_purchases where id = v_purchase_id) <> 'pending' or v_balance <> 0 then
    raise exception 'Returned cheque must reverse credits and restore pending payment';
  end if;
end;
$$;

rollback;
