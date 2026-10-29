# Madusanca Driving School — Project Plan

> **Superseded by `PLAN.md`** for current architecture/decisions (brand: Wisdom Driving Academy, BC, navy/lime public identity). This file tracks phase status.

## Overview
A professional Canadian driving school website built with Next.js, React, TypeScript, and Tailwind CSS. The platform will support public booking, admin management, student self-service, and Stripe payments (later phase).

## Development Phases

### Phase 1 — Foundation, Design System & Homepage
- [x] Initialize Next.js project with TypeScript, Tailwind, ESLint
- [x] Configure Supabase environment-placeholders
- [x] Navy/lime public design system: Manrope + DM Sans, owner-supplied logo asset; existing admin gold styling retained
- [x] Full-width concept-photo hero and responsive editorial typography
- [x] Responsive homepage: hero, lessons preview, how-it-works, photo-led approach, FAQ, CTA
- [x] Reusable navigation, footer, button, lesson-card components (rebranded to Wisdom Driving Academy)
- [x] Framer Motion scroll reveals + `prefers-reduced-motion` support
- [x] .gitignore with secret protection
- [x] TypeScript, ESLint, production build, local runtime verified

### Phase 2 — Public Pages
- [x] `(public)` route group with shared Nav/Footer layout
- [x] `/lessons` live catalogue (four approved packages; swipeable on mobile)
- [x] `/about` — approach + expectations, honest credential placeholders
- [x] `/contact` — info cards + contact form → `/api/contact` (zod, honeypot, rate limit, Resend-or-console)
- [x] `/privacy` — BC PIPA + PIPEDA compliant policy
- [x] `/terms` — BC-law booking terms with ICBC non-affiliation disclaimer
- [x] `/accessibility` — WCAG 2.1 AA commitment (Access by Design 2030)
- [x] Temp `/booking` → `/lessons` redirect (added during Phase 2, removed in Phase 3)

### Phase 3 — Booking System (Public)
- [x] Supabase schema + migrations (`supabase/migrations/0001_initial_schema.sql`, deny-all RLS)
- [x] Atomic availability/conflict Postgres functions (advisory day lock + overlap checks)
- [x] Booking engine libs: Vancouver-tz slot grid, SHA-256 tokens, store layer (Supabase RPC / local JSON fallback)
- [x] `/api/availability`, `/api/bookings`, `/api/bookings/manage` (rate-limited, zod-validated, honeypot)
- [x] Public booking wizard (`/booking`) + student self-service manage link (`/booking/manage?token=…`)
- [x] Booking confirmation / reschedule / cancellation emails (Resend-or-console)
- [x] Temp `/booking` → `/lessons` redirect removed

### Phase 4 — Admin Dashboard
- [x] Supabase Auth sign-in (`/admin/login`, server action + `@supabase/ssr` cookie sessions)
- [x] `src/proxy.ts` route guard (Next 16 replaces middleware.ts) + `requireAdmin()` role check (ADMIN_EMAILS allowlist or `profiles.role=admin`)
- [x] Admin shell: dark sidebar / mobile pill nav, sign-out, `force-dynamic` layout
- [x] Dashboard: stat cards, today's schedule, next-up list, monthly value
- [x] Bookings table: search + status/range filters, complete/cancel actions, reschedule dialog with live availability + conflict check
- [x] Calendar: BookingTimes-style schedule time-grid (week default): hour rows, lane-split chips, closed-hour hatching, blackout shading, status legend; day agenda with actions; month overview
- [x] Students: derived directory from bookings (no student accounts)
- [x] Lessons: **full catalogue editor** (name, duration, price, description, features, category, popular) — store-backed, publishes to homepage/lessons/booking wizard instantly
- [x] Settings: weekly availability editor + blackout dates (service-key CRUD)
- [x] Lessons store layer: `getLessons`/`saveLesson` on file + Supabase stores; migration `0002_lessons.sql` (falls back to code catalogue until run)
- [x] Calendar filters, click-to-book from free 30-minute slots, drag/drop reschedule with server conflict/hour checks, mobile day slot picker

### Phase 4b — Student Self-Service
- [x] Private manage link emailed at booking (reschedule/cancel with live conflict checks + token rotation) — Phase 3
- [x] **"Find my booking" verifier**: `/booking/manage` + nav "My Booking" + footer + manage-error card → `POST /api/bookings/otp` (`send`/`verify`/`token` actions)
  - Security: 6-digit code, SHA-256 hashed + bound to email, 10-min TTL, 5-attempt lock, per-IP + per-email rate limits, generic send response (no email enumeration), token only issued after verification, OTP consumed on token issue
  - After verify: booking list (reference/lesson/time/status) → Manage → server issues hashed 30-day manage token → redirects into the existing reschedule/cancel UI
  - Migration `0003_booking_otps.sql` ready (file store used until service key + migration)
  - Verified via curl: send → generic (+ code in dev console via `devHint`) → wrong code 400 → verify returns list → token → manage `get` works → consumed code = expired → 5 wrong attempts = locked → unknown email = identical generic response, no code sent
- [x] OTP email template (`Your verification code`, dev-only `devHint` never logged in production)

### Phase 5 — Email
- [x] Templates: confirmation, rescheduled, cancelled, owner alert, one-time verification code
- [x] Resend API key configured in `.env.local`; direct test email accepted by Resend to the account owner
- [ ] Verify a sending domain to deliver transactional email to students at any address

### Phase 6 — Hardening
- [ ] Security headers, rate limiting, a11y + reduced-motion audit, legal copy finalization

### Phase 7 — Payments (Deferred)
- [ ] Stripe Checkout with verified webhooks (schema already Stripe-ready)

### Phase 8 — Deployment
- [ ] Docker configuration for Hostinger VPS + Dokploy (only after explicit user approval)

## Design Requirements
- Navy/lime premium public identity (Manrope headings, DM Sans body) per the owner-supplied HTML concept
- Full-width photographic hero with restrained overlay and the supplied logo
- Subtle animations only for supporting sections and controls; keep the hero photographic and restrained
- Accessible interactions and reduced-motion support
- Excellent mobile responsiveness (320px → 1440px+)
- Clear visual hierarchy

## Security Requirements
- Never commit Supabase secret/service-role keys
- Never commit Stripe secret keys
- Never commit database passwords or real customer data
- Use `.env.example` with placeholders only
- Protect staff routes with server-side authorization
- Implement proper database Row Level Security
- Server-only booking writes; zod validation on every API
- Hashed expiring booking tokens
- Never expose private details in design JSON or client bundles

## Tech Stack
- Next.js 16 (App Router)
- React 19
- TypeScript
- Tailwind CSS 4
- ESLint
- Supabase PostgreSQL
- Supabase Auth
- Stripe (later phase)
- Framer Motion
- Resend + React Email
- Zod
- Docker

## Current Status
- **Phase 1**: ✅ Complete — Navy/lime public redesign with the supplied concept
  - Public-only navy/lime tokens, Manrope + DM Sans via next/font; admin retains its gold styling
  - Owner-supplied PNG logo extracted from HTML; full-width local hero photograph
  - Homepage: editorial hero, lesson preview (4 real packages), dark how-it-works, photo-led approach, FAQ accordion, lime CTA
  - Responsive dark navigation and footer with working links, service areas, contact and configurable socials
  - All "Madusanca" public text rebranded to Wisdom Driving Academy
  - Verified after redesign: `tsc` 0 errors, `lint` 0 errors/warnings, `build` OK; public routes and three new local image assets return HTTP 200
  - **Awaiting user review of the updated design at localhost:3000**
- **Phase 2**: ✅ Complete — public pages built and verified
  - Route group `(public)` with shared sticky nav + footer
  - `/lessons` (4 owner-approved packages, mobile swipe cards), `/about`, `/contact` (working form + API)
  - Legal: `/privacy` (PIPA/PIPEDA), `/terms` (BC law, ICBC disclaimer), `/accessibility` (WCAG 2.1 AA)
  - Contact API: zod validation, honeypot, 5-req/10-min rate limit, Resend-or-console delivery
  - Verified: `tsc` 0 errors, `lint` 0 errors/warnings, `build` OK, all routes HTTP 200, API cases tested
  - Mobile fix: lesson cards became a swipeable scroll-snap carousel (`LessonGrid`) below `md`
  - **Awaiting user review at localhost:3000**
- **Phase 3**: ✅ Complete — booking engine built and E2E verified locally (file-store fallback)
  - Slot engine: America/Vancouver wall-clock, 30-min grid, 2h lead, 90-day horizon, Mon–Sat hours, blackouts
  - Stores: Supabase atomic RPCs (service-role only) or local `.data/store.json` in dev (gitignored)
  - APIs: `/api/availability`, `/api/bookings`, `/api/bookings/manage` (rate-limited, zod, honeypot, token-hashed)
  - UI: 4-step booking wizard + `/booking/manage?token=…` (view/reschedule/cancel, masked email, token rotation)
  - Emails: confirmation, reschedule, cancellation + owner alert (Resend-or-console)
  - Migration ready: `supabase/migrations/0001_initial_schema.sql` (deny-all RLS, atomic RPCs, seeded hours)
  - Verified: `tsc` 0 errors, `lint` 0 errors/warnings, `build` OK; create → 409 conflict → get → reschedule (token rotation) → cancel all tested via curl; past/Sunday/soon slots and honeypot rejected
  - **Needs from user**: `SUPABASE_SERVICE_ROLE_KEY` + run migration 0001
  - **Awaiting user review at localhost:3000/booking**
- **Phase 4**: ✅ Complete — Supabase Auth + admin panel + this pass's upgrades verified locally
  - `/admin/login` server-action sign-in → Supabase cookie sessions via `@supabase/ssr`
  - `src/proxy.ts` (Next 16 middleware replacement) guards `/admin/*`; `requireAdmin()` enforces ADMIN_EMAILS or `profiles.role=admin`
  - Dashboard, bookings table (search/filter/complete/cancel + reschedule dialog), students (derived), settings (hours + blackouts)
  - **Lessons editor**: `/admin/lessons` inline editor (name/duration/price/description/features/category/popular) → `store.saveLesson` → revalidates `/`, `/lessons`, `/admin/lessons`; catalogue now store-backed everywhere (file store now, Supabase `lessons` table after migrations 0002/0004)
  - **Calendar advanced**: week/day/month views; 30-minute rows; click free slot to create an emailed booking; drag/drop reschedule with server-side hours, lead-time, blackout and conflict checks; student/status filters; mobile/tablet day agenda and bookable time buttons
  - **Student self-service**: manage link on booking email; **"Find my booking" verifier**: email → 6-digit code (hashed, 10-min, 5-try lock, max 3 sends per email/day, 2-minute cooldown) → eligible booking list → manage token. OTPs only sent for active bookings more than 48 hours away; late changes direct students to the school's configured contact channel. Student reschedules are capped at two per booking; admin reschedules remain unrestricted.
  - **New owner content from requirements PDF**: packages $90/$450/$720/$150 CAD + GST; four supplied FAQ answers; beginner-focused About/hero content; service areas and contact details; social link slots awaiting official URLs
  - **Booking form**: first/last/legal name, BC licence class, email, phone, full pickup address; no account required (email one-time-code self-service). Licence number, DOB and gender intentionally excluded from online collection to reduce sensitive data; student brings licence to lesson.
  - **48-hour policy**: self-service cancel/reschedule blocked within 48 hours in UI and API; policy/refund/general-policy copy updated from supplied requirements; admin can still manage bookings.
  - Migrations `0002`/`0004` seed/update packages, `0003` stores OTPs, `0005_student_reschedule_and_otp_limits.sql` adds student reschedule count and persistent OTP send limits.
  - OTP email delivery now returns a delivery status; the self-service UI reports confirmation/reschedule email delivery instead of claiming success if Resend rejects it
  - Public redesign changes only presentation components and assets; booking APIs, storage, validation, admin scheduling and OTP flow remain intact
  - Public store pages are `force-dynamic` (Next 16 prerenders `searchParams` pages — build guard requires it)
  - **Needs from user**: `SUPABASE_SERVICE_ROLE_KEY` (real Postgres data), run migrations 0002 → 0003 → 0004 → 0005, review at localhost:3000; official Google/Instagram/Facebook/YouTube URLs
- **Phase 5**: Transactional email sender is configured through environment settings; a test send was accepted by the email provider.
- **Phase 6**: Pending — security hardening
- **Phase 7**: Pending — Stripe (deferred by user decision)
- **Phase 8**: Pending — Docker deployment (requires explicit user approval to push/deploy)

## Phase 9 — Technical SEO (local implementation, 2026-10-29)

- [x] Audited existing metadata and kept the established route structure and visual design; no SEO-only thin pages were created.
- [x] Added shared Next.js Metadata API helpers for page titles/descriptions, canonical URLs, Open Graph, Twitter/X cards, and robots directives.
- [x] Added native `app/robots.ts` and `app/sitemap.ts`. Local/staging builds default to disallow indexing and an empty sitemap; admin, API and booking-management paths are excluded.
- [x] Added branded 1200×630 Open Graph image using the approved logo and brand colours.
- [x] Added JSON-LD for the school as an Organization/LocalBusiness and a WebSite entity when the canonical origin is configured. It uses only already-public contact/service-area details; no address, hours, reviews, ratings, prices or qualifications are invented.
- [x] Improved public page title/description coverage, Canadian English `lang`, interior heading hierarchy, footer policy links, and reduced-motion handling for Framer Motion.
- [x] Converted the hero photograph to WebP (same 1672×941 dimensions; about 2.9 MB PNG → 328 KB WebP). The approved PNG source remains in `public/`.
- [x] Local production build checks: TypeScript, ESLint and `next build` passed; production dependency audit found 0 vulnerabilities. The homepage, About, Contact, legal, accessibility, booking-manage and staff auth routes were checked locally; public pages tested each had one H1, while manage/admin pages are `noindex`.
- [x] Local desktop Lighthouse audits on `/` and `/about`: SEO 100, Accessibility 100, Best Practices 100, no reported failures after a small text-contrast adjustment. This is not a mobile or Core Web Vitals performance test.
- [x] Verified the generated Open Graph asset returns PNG at 1200×630 and local `robots.txt`/`sitemap.xml` do not expose preview URLs.
- [ ] Owner to confirm the official HTTPS domain and set `NEXT_PUBLIC_CANONICAL_ORIGIN`; keep `NEXT_PUBLIC_SEO_INDEXING_ENABLED=false` for local/staging and set it to `true` only for the verified production domain.
- [ ] Confirm public operating hours and any business address/pickup policy before adding those details to visible copy or structured data. Do not publish a private residence.
- [ ] Validate production structured data and social-image URL with Schema Markup Validator / Rich Results Test after the site has an approved public HTTPS URL.
- [ ] Claim/verify Google Business Profile and Bing Webmaster Tools after launch; only the owner can complete account verification. Add Search Console verification token after owner supplies it. No analytics or tracking scripts have been added.
- [ ] If the owner approves GA4, configure it with Canadian privacy/consent requirements in mind, prohibit personal-data collection, and count only successfully confirmed bookings as conversions (not button clicks).
- [ ] Measure mobile Core Web Vitals and field data after launch. The in-app Lighthouse check audits SEO/accessibility/best practices but does not provide performance metrics.
- **Routes retained:** `/lessons` remains the real catalogue route; FAQ remains useful homepage content. No empty `/faq`, beginner, road-test-prep or refresher routes were added. Add new routes only with distinct owner-verified content.
