-- Wisdom Driving Academy — email verification codes for the self-service
-- booking finder ("find my booking" without a link).
-- Run in the Supabase SQL editor, or via `supabase db push`.
--
-- Only SHA-256 hashes of the 6-digit code are stored; codes live 10 minutes
-- and lock after 5 wrong attempts (enforced app-side).

create table if not exists public.booking_otps (
  email text primary key,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.booking_otps enable row level security;
-- Deny-all on purpose: only the service role reads/verifies codes.
