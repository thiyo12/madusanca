# Data-safe development and release workflow

## Required environment boundaries

| Environment | Supabase | Payments | Email | Data |
| --- | --- | --- | --- | --- |
| Local development | Local Supabase CLI project at loopback, or the app's local file store when Supabase is not configured | Stripe Test Mode only | No external email API key; local fallback logs test messages | Synthetic fixtures only |
| Staging | Dedicated staging Supabase project | Stripe Test Mode only | Dedicated test provider/key and controlled recipients | Synthetic student/admin accounts only |
| Production | Production Supabase project, accessed only by the production Dokploy app | Keep the current mode until separately approved; never switch modes as part of a routine deploy | Production provider credentials scoped only to production | Real customer records; never reset, copy to lower environments, or use for development |

The three environments must not share Supabase project keys, Stripe secrets, email credentials, storage volumes, backups, or deployment hooks. `NEXT_PUBLIC_*` variables are embedded during the Next.js build. Build staging and production separately with the correct public Supabase URL/key and site origin; do not promote a build artifact containing another environment's public configuration.

## Local startup guard

`npm run dev` now calls `scripts/dev-local.mjs` before starting Next.js. It requires `WDA_APP_ENV=local`, rejects non-loopback Supabase URLs, rejects Stripe live keys/live-payment opt-in, and rejects external Resend credentials. It does not print configured values. This prevents accidentally using a hosted Supabase project from the standard local development command.

For full local integration, copy `.env.local.example` to ignored `.env.local`, start the local Supabase stack (`supabase start`), and fill its local API URL/keys from `supabase status -o env`. Never use a hosted project's URL or keys there. Local email should use the built-in Supabase test inbox or the app's console fallback. Local booking data is disposable and synthetic. The older `.env.example` is only a variable reference and must not be copied into localhost configuration.

## Migration lifecycle (forward-only)

1. Make each schema change as a new, monotonically versioned SQL migration. Never edit a migration that has been applied to a shared environment; correct mistakes with a later migration.
2. Run `npm run db:migrations:check`. It must pass before any migration command. At present it intentionally **fails** because two files use version `0058`; that is a release blocker, not permission to rename either file.
3. Determine actual migration state through authorized read-only access separately for staging and production. Compare migration versions and names. If history is ambiguous, stop: do not repair `supabase_migrations.schema_migrations` manually, reset a hosted database, or infer state from filenames.
4. Resolve the duplicate only after that evidence exists. Preserve applied migration history. If one `0058` migration was omitted in a target, create a new uniquely numbered forward migration after the confirmed latest version, with an idempotent/reviewed correction as appropriate. Validate the resulting chain on a disposable local database first. No migration is authorized by this document.
5. Review SQL for data loss, locks, long table rewrites, defaults/backfills, RLS/grants, RPC permissions, and compatibility with both old and new app versions. For changes that can affect live data, use expand → backfill in bounded batches → verify → contract in a later release. Do not drop/rename columns or rewrite historical payment/booking facts in the same release that removes old code.
6. Test from a clean disposable local database and from a copy-free staging database. Local `supabase db reset` is destructive to the local Supabase database; confirm the CLI target is local before using it. Never run reset against a hosted project.
7. Before a production migration, the owner must verify the target project reference in the Supabase dashboard, confirm a recent encrypted backup exists, and confirm a restore has been tested. Take/verify a pre-change backup and agree on a rollback/forward-fix plan. Apply only the reviewed migration to the confirmed production project, with explicit approval; then verify migration ledger and application invariants.

## Preserve bookings, payments, student records, and lesson balances

- Do not truncate, reset, replace, or reseed a hosted database.
- Treat booking references, Stripe event IDs, payment records, package-credit events, and student links as business records. Schema work must preserve identifiers and auditability.
- Preserve `package_credit_events` as the ledger of lesson-balance changes; do not directly rewrite balances to make a migration appear successful. Reconcile totals before and after a change.
- Use additive migrations first. Backfills must be repeatable, bounded, observable, and safe to resume. Deletions/anonymization need a separate approved retention process and must preserve legally required financial/audit records.
- Never export production data into development or staging. Generate synthetic accounts, bookings, payments, and balances. Validate backups using isolated restore destinations, never over the live database.

## Release controls

1. Develop and run tests on a feature branch. Do not point local tests at production.
2. Run security tests, lint, TypeScript, build, migration-version check, and SQL/integration tests against disposable local data.
3. Push/deploy to staging only with explicit approval. Staging deploys must use `feat/security-remediation-local` or the specifically approved feature branch and staging-only resources. Verify environment identity, smoke tests, authorization, payment/webhook idempotency, booking concurrency, and migration results.
4. Production remains connected to `main`. Only an approved release PR/merge can change `main`; this assistant will not push, deploy, apply hosted migrations, or change Dokploy settings without explicit approval.
5. Before production release, review the exact commit and migration diff, verify backup/restore readiness, and approve deployment and migration as separate consequential actions. Monitor booking creation, payment fulfillment, webhook deduplication, package balances, and errors afterward. Roll back application code only if schema remains backward-compatible; otherwise use a reviewed forward fix.
6. Stripe Live Mode is a separately approved business/security decision. Continue using Test Mode in local and staging. Do not change production payment mode or keys without explicit owner approval and a verified end-to-end staging run.

## Current migration caveat

The repository has duplicate version `0058` (`0058_allow_partial_tutor_reports.sql` and `0058_enforce_ten_minute_otp_resend_cooldown.sql`). Actual hosted migration history has not been established in this workflow. No file was renamed and no production migration history was modified. Migration checks must remain blocked until an owner-authorized read-only history review establishes the safe correction.
