-- pgcrypto is installed in the Supabase `extensions` schema, while these
-- booking functions use a restricted public search_path. Qualify the function.
create or replace function public.new_reference()
returns text
language plpgsql
set search_path = public, extensions
as $$
declare
  candidate text;
begin
  loop
    candidate := 'WDA-' || upper(substr(encode(extensions.gen_random_bytes(4), 'hex'), 1, 6));
    exit when not exists (select 1 from public.bookings b where b.reference = candidate);
  end loop;
  return candidate;
end;
$$;

select pg_notify('pgrst', 'reload schema');
