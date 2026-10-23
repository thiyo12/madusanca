-- Security first: staff roles are read-only from client sessions.
create table if not exists public.staff_roles(user_id uuid not null references auth.users(id) on delete cascade,role text not null check(role in('admin','instructor')),created_at timestamptz not null default now(),primary key(user_id,role));
alter table public.staff_roles enable row level security;
create policy "staff can read own role" on public.staff_roles for select to authenticated using ((select auth.uid())=user_id);
-- Assign admin roles only from trusted Supabase dashboard. Enforce MFA before production.
