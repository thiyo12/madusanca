# Setup

1. Install Node.js 22.
2. Run `npm install` and `npm run dev`.
3. Create a Supabase project. Run the `supabase/migrations/0001_foundation.sql` migration in SQL Editor.
4. Copy `.env.example` to `.env.local` and enter your **project URL and publishable key only**. Never commit `.env.local`.
5. Enable email sign-in for staff in Supabase and provision an administrator by a trusted workflow. Add a matching `staff_roles` record using Supabase SQL Editor. Do not expose privileged credentials in browser code.
6. Before production, enforce MFA, validate deployment configuration, set up backups, rate limiting, email verification and security testing.

No live payment or booking functionality is implemented yet.
