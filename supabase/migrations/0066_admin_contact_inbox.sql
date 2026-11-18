create table public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  email text not null check (char_length(email) between 3 and 160),
  phone text not null check (char_length(phone) between 7 and 25),
  subject text not null default '' check (char_length(subject) <= 120),
  message text not null check (char_length(btrim(message)) between 10 and 2000),
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index contact_messages_created_at_idx
  on public.contact_messages (created_at desc);
create index contact_messages_unread_idx
  on public.contact_messages (created_at desc)
  where is_read = false;

alter table public.contact_messages enable row level security;
revoke all on public.contact_messages from public, anon, authenticated;
grant select, insert, update on public.contact_messages to service_role;
