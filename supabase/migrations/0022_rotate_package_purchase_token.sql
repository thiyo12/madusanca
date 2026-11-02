-- Rotate a purchase's customer access token atomically. A failed insert must
-- never leave the purchase with its previous valid token already deleted.
create or replace function public.rotate_package_purchase_token(
  p_purchase_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if p_token_hash is null or length(p_token_hash) <> 64 or
     p_expires_at is null or p_expires_at <= now() or
     p_expires_at > now() + interval '31 days' then
    return false;
  end if;

  perform 1 from public.package_purchases
  where id = p_purchase_id and payment_status in ('pending', 'paid')
  for update;
  if not found then return false; end if;

  delete from public.package_purchase_tokens where purchase_id = p_purchase_id;
  insert into public.package_purchase_tokens(token_hash, purchase_id, expires_at)
  values (p_token_hash, p_purchase_id, p_expires_at);
  return true;
end;
$$;

revoke all on function public.rotate_package_purchase_token(uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.rotate_package_purchase_token(uuid, text, timestamptz)
  to service_role;
