# Developer Handover

> **Project owner and builder: Thiyoth.** This is Thiyoth's Wisdom Driving Academy website and booking application. Treat product decisions, production access, and changes to live data as owner-controlled.

This guide helps a new developer find the important parts of the codebase. The current layout already follows the standard Next.js App Router pattern. Keep route files in place unless a route change is specifically intended and reviewed; moving files under `src/app` can change URLs or application behavior.

## Project layout

```text
src/
  app/
    (public)/       Public website pages. Parentheses are a Next.js route group,
                    so `(public)` does not appear in the URL.
    admin/          Admin pages and admin-only actions.
    api/            API route handlers (`route.ts`).
    auth/           Authentication callback routes.
    layout.tsx      Root document layout and global CSS import.
    globals.css     Global styles.
  components/
    booking/        Booking, scheduling, and package-purchase UI.
    layout/         Site navigation, headers, and footer.
    sections/       Public home-page sections.
    admin/          Shared admin UI.
    ui/             Reusable UI primitives.
  lib/
    booking/        Booking rules, types, storage adapters, and access helpers.
    data/           Lesson/package catalogue defaults.
    stripe/         Checkout, payment validation, and fulfillment.
    supabase/       Supabase clients and server helpers.
    email/          Transactional email helpers.
    validation/     Request and form schemas.
    server/         Server-only security and request helpers.
    auth/           Admin access checks.
public/             Static assets served from the site root.
supabase/
  migrations/       Ordered database migrations. Do not edit migrations already
                    applied to production; add a new numbered migration instead.
tests/              Security tests and SQL regression fixtures.
scripts/            Local maintenance scripts.
```

## Useful starting points

- `src/app/(public)/booking/page.tsx` — public booking page.
- `src/components/booking/booking-wizard.tsx` — booking steps and customer selections.
- `src/components/booking/date-time-step.tsx` — date and time picker.
- `src/lib/booking/slots.ts` — availability grid, occupancy, and conflict rules.
- `src/app/api/bookings/route.ts` — validates and creates a booking request.
- `src/app/api/stripe/checkout/route.ts` — combined booking/package Checkout.
- `src/app/api/stripe/webhook/route.ts` and `src/lib/stripe/fulfill.ts` — payment event fulfillment.
- `src/lib/booking/store.ts` — selects the booking storage implementation.
- `src/lib/booking/supabase-store.ts` — production Supabase storage adapter.
- `src/lib/booking/file-store.ts` — file-backed adapter for supported local development flows.
- `src/lib/data/lessons.ts` — fallback lesson/package catalogue.
- `supabase/migrations/` — database schema and database-side booking safeguards.

When changing a booking or payment flow, trace it end to end: UI → API validation → storage/RPC → Checkout → verified webhook fulfillment. UI-only checks are not sufficient for protecting appointment conflicts or payment totals.

## Local setup and checks

Requirements: Node.js compatible with the project and npm.

```bash
npm install
cp .env.example .env.local
# Fill local-only values in .env.local using the approved secret-management process.
npm run dev
```

Available checks:

```bash
npx tsc --noEmit
npm run lint
npm run test:security
npm run build
```

Use synthetic customer details and test-mode payment credentials for development. Do not create real appointments or submit real charges as a test. SQL fixtures in `tests/sql/` create records; run them only in a disposable local/test database, never against production.

## Credentials and production safety

- `.env.example` contains placeholders. Keep actual values in an approved secret manager or private local environment file; never put them in source code, issues, screenshots, terminal transcripts, or handover documents.
- Do not read, replace, rotate, or copy live credentials as part of routine code organization. Ask Thiyoth before any credential or production-access change.
- Never commit `.env.local`, service-role keys, Stripe secrets, webhook secrets, student details, database exports, backups, or logs.
- Do not run seed scripts, SQL fixtures, or destructive database commands against production.
- Supabase migrations are ordered and production data must be preserved. Review each new migration and its rollback/recovery implications before applying it.
- A GitHub push by itself does **not** deploy this application. Confirm the configured hosting project, target environment, deploy process, and successful health check with Thiyoth before claiming a release is live.
- Live Stripe payments are separately gated. Do not enable them or change tax configuration without explicit owner approval.

## Ownership and changes

Thiyoth is the project owner and final decision-maker for branding, business rules, production access, and releases. Keep changes focused, explain meaningful tradeoffs in the pull request, and avoid broad file moves just to match a generic starter template. The current `src/app`, `src/components`, `src/lib`, and `public` structure is intentional and already follows the App Router organization.
