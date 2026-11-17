alter table public.bookings
  add column if not exists cancellation_reason text;
alter table public.package_purchases
  add column if not exists refund_reason text;

create or replace function public.admin_cancel_booking_package(
  p_booking_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_package_id uuid;
  v_record public.bookings%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if length(v_reason) < 3 or length(v_reason) > 500 then
    return jsonb_build_object('ok', false, 'error', 'invalid_reason');
  end if;
  select package_id into v_package_id from public.bookings where id = p_booking_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not exists (select 1 from public.bookings where package_id = v_package_id and status not in ('cancelled', 'completed')) then
    return jsonb_build_object('ok', false, 'error', 'not_modifiable');
  end if;
  update public.bookings
  set status = 'cancelled', cancellation_reason = v_reason, updated_at = now()
  where package_id = v_package_id and status <> 'completed';
  select * into v_record from public.bookings where id = p_booking_id;
  return jsonb_build_object('ok', true, 'record', to_jsonb(v_record));
end;
$$;
revoke all on function public.admin_cancel_booking_package(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_cancel_booking_package(uuid, text) to service_role;

create or replace function public.admin_mark_package_purchase_refunded(
  p_purchase_id uuid,
  p_reason text
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_purchase public.package_purchases%rowtype;
  v_balance integer;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'Refund reason must be between 3 and 500 characters';
  end if;
  select * into v_purchase from public.package_purchases where id = p_purchase_id for update;
  if not found then return false; end if;
  if v_purchase.payment_status = 'refunded' then return true; end if;
  if v_purchase.payment_status <> 'paid' then return false; end if;

  select coalesce(sum(quantity_delta), 0)::integer into v_balance
  from public.package_credit_events where purchase_id = p_purchase_id;
  if v_balance < 0 then
    raise exception 'Package credit balance is invalid; manual reconciliation is required';
  end if;

  if v_balance > 0 then
    insert into public.package_credit_events (
      purchase_id, event_type, quantity_delta, source_key, note
    ) values (
      p_purchase_id, 'refund', -v_balance,
      'admin-refund:' || p_purchase_id::text,
      v_reason
    ) on conflict (source_key) do nothing;
  end if;
  update public.package_purchases
  set payment_status = 'refunded', refund_reason = v_reason, updated_at = now()
  where id = p_purchase_id;
  return true;
end;
$$;
revoke all on function public.admin_mark_package_purchase_refunded(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_mark_package_purchase_refunded(uuid, text) to service_role;
