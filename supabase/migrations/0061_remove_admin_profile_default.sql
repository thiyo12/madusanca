-- Creating a profile must never grant an administrator role implicitly.
-- Admin privileges require an explicit, owner-controlled role assignment.
alter table public.profiles
  alter column role drop default;
