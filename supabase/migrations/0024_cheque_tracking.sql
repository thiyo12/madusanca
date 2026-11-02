alter table public.bookings
  add column if not exists cheque_status text not null default 'none'
    check (cheque_status in ('none', 'received', 'cleared', 'returned')),
  add column if not exists cheque_reference text,
  add column if not exists cheque_received_at timestamptz;

alter table public.package_purchases
  add column if not exists cheque_status text not null default 'none'
    check (cheque_status in ('none', 'received', 'cleared', 'returned')),
  add column if not exists cheque_reference text,
  add column if not exists cheque_received_at timestamptz;

alter table public.bookings
  add constraint booking_cleared_cheque_is_paid
    check (cheque_status <> 'cleared' or payment_status = 'paid');

alter table public.package_purchases
  add constraint package_cleared_cheque_is_paid
    check (cheque_status <> 'cleared' or payment_status in ('paid', 'refunded'));

comment on column public.bookings.cheque_reference is 'Optional admin-entered cheque identifier; do not store bank account data.';
comment on column public.package_purchases.cheque_reference is 'Optional admin-entered cheque identifier; do not store bank account data.';

create or replace function public.record_package_cheque(
  p_purchase_id uuid,
  p_status text,
  p_reference text default null
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_purchase public.package_purchases%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_status not in ('none', 'received', 'cleared', 'returned') then
    raise exception 'Invalid cheque status';
  end if;
  select * into v_purchase from public.package_purchases where id = p_purchase_id for update;
  if not found then return null; end if;
  if p_status = v_purchase.cheque_status then return p_purchase_id; end if;
  if p_status = 'cleared' and v_purchase.payment_status not in ('pending', 'failed', 'paid') then
    raise exception 'Only a pending purchase can be cleared by cheque';
  end if;
  if p_status = 'returned' and v_purchase.cheque_status not in ('received', 'cleared') then
    raise exception 'Only a received cheque can be returned';
  end if;
  update public.package_purchases
  set cheque_status = p_status,
      cheque_reference = case when p_status = 'none' then null else nullif(left(trim(coalesce(p_reference, '')), 80), '') end,
      cheque_received_at = case when p_status in ('received', 'cleared') then v_now else null end,
      payment_status = case when p_status = 'cleared' then 'paid' when p_status = 'returned' then 'pending' else payment_status end,
      purchased_at = case when p_status = 'cleared' then v_now when p_status = 'returned' then null else purchased_at end,
      valid_until = case when p_status = 'cleared' then v_now + interval '6 months' when p_status = 'returned' then null else valid_until end,
      updated_at = v_now
  where id = p_purchase_id;
  if p_status = 'cleared' then
    insert into public.package_credit_events (purchase_id, event_type, quantity_delta, source_key, note)
    values (p_purchase_id, 'grant', v_purchase.credits_purchased, 'cheque-cleared:' || p_purchase_id::text || ':' || extract(epoch from v_purchase.updated_at)::text, 'Cheque payment cleared')
    on conflict (source_key) do nothing;
  elsif p_status = 'returned' then
    insert into public.package_credit_events (purchase_id, event_type, quantity_delta, source_key, note)
    values (p_purchase_id, 'refund', -v_purchase.credits_purchased, 'cheque-returned:' || p_purchase_id::text || ':' || extract(epoch from v_purchase.updated_at)::text, 'Cheque returned')
    on conflict (source_key) do nothing;
  end if;
  return p_purchase_id;
end;
$$;

revoke all on function public.record_package_cheque(uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_package_cheque(uuid, text, text) to service_role;
