-- A Checkout Session can now contain more than one add-on package type.
-- package_purchases intentionally share the one real Stripe session ID.
alter table public.package_purchases
  drop constraint if exists package_purchases_stripe_checkout_session_id_key;

create index if not exists package_purchases_stripe_checkout_session_id_idx
  on public.package_purchases (stripe_checkout_session_id);

create or replace function public.create_scheduled_package_purchase_bundle(
  p_purchases jsonb,
  p_manage_token_hash text,
  p_session_id text,
  p_expires_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_item jsonb;
  v_result jsonb;
  v_records jsonb := '[]'::jsonb;
  v_index integer := 0;
  v_id uuid;
begin
  if jsonb_typeof(p_purchases) is distinct from 'array' or
     jsonb_array_length(p_purchases) < 1 or jsonb_array_length(p_purchases) > 10 or
     p_session_id is null or length(p_session_id) < 8 then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  for v_item in select value from jsonb_array_elements(p_purchases)
  loop
    v_index := v_index + 1;
    v_id := (v_item->>'id')::uuid;
    v_result := public.create_scheduled_package_purchase_checkout(
      v_id, v_item->>'reference', v_item->>'lesson_id',
      (v_item->>'quantity')::integer, (v_item->>'amount_cad')::numeric,
      v_item->'starts_at', p_manage_token_hash,
      p_session_id || '_bundle_' || v_index::text, p_expires_at,
      v_item->>'notes'
    );
    if coalesce((v_result->>'ok')::boolean, false) is not true then
      raise exception 'package bundle reservation failed';
    end if;
    update public.package_purchases
      set stripe_checkout_session_id = p_session_id, updated_at = now()
      where id = v_id;
    v_records := v_records || jsonb_build_array(v_result->'record');
  end loop;

  return jsonb_build_object('ok', true, 'records', v_records);
exception
  when others then
    return jsonb_build_object('ok', false, 'error', 'conflict');
end;
$$;

revoke all on function public.create_scheduled_package_purchase_bundle(jsonb, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.create_scheduled_package_purchase_bundle(jsonb, text, text, timestamptz)
  to service_role;
