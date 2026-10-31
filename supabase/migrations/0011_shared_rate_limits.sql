-- Shared request throttling for horizontally scaled application instances.
create table if not exists public.app_rate_limits (
  key_hash text primary key check (length(key_hash) = 64),
  window_started_at timestamptz not null,
  hits integer not null check (hits >= 0)
);

alter table public.app_rate_limits enable row level security;

create or replace function public.consume_rate_limit(
  p_key_hash text,
  p_max_hits integer,
  p_window_ms integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_started timestamptz;
  v_hits integer;
begin
  if p_key_hash !~ '^[0-9a-f]{64}$' or p_max_hits < 1 or p_window_ms < 1 then
    return true;
  end if;

  -- Opportunistically remove abandoned keys without scanning the table on every request.
  if random() < 0.01 then
    delete from public.app_rate_limits where window_started_at < now() - interval '2 days';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_key_hash, 0));
  select window_started_at, hits into v_started, v_hits
    from public.app_rate_limits where key_hash = p_key_hash for update;

  if not found or v_started + (p_window_ms * interval '1 millisecond') <= now() then
    insert into public.app_rate_limits (key_hash, window_started_at, hits)
      values (p_key_hash, now(), 1)
      on conflict (key_hash) do update
        set window_started_at = excluded.window_started_at, hits = 1;
    return false;
  end if;

  if v_hits >= p_max_hits then return true; end if;
  update public.app_rate_limits set hits = hits + 1 where key_hash = p_key_hash;
  return false;
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
