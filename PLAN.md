# Wisdom Driving Academy — Build Plan

> Living build document. Read this before starting any phase of work.

## Locked Decisions

| Decision | Choice |
|---|---|
| Brand name | **Wisdom Driving Academy** (rename all "Madusanca" text) |
| Province | **British Columbia** — ICBC Class 7 / Class 5 terminology, BC PIPA privacy law |
| Payments (v1) | **Manual payment** (e-transfer/cash/in-person). Schema keeps `payment_status` Stripe-ready for Phase 4 |
| Email delivery | **Resend** — confirmation, reschedule, cancel, owner alerts. Graceful console fallback when `RESEND_API_KEY` missing locally |
| Logo & hero imagery | **Owner-supplied logo** and locally stored concept photography in `/public` |
| Design reference | Owner's navy-and-lime `wisdom-premium-homepage-logo-updated.html` concept, applied to all public pages; retain live packages and booking behaviour |
| Workflow | Localhost → test → review → GitHub → Hostinger/Dokploy. **Never push to GitHub or deploy without explicit user approval** |
| Git | Work on a feature branch; commit only with user approval; never commit secrets |

---

## 1. Design System

- **Public colors:** Navy `#0b1b29`, Ink `#10212e`, Lime `#c2ee84`, Cream `#f7f7f3`, Line `#e3e8e6`. Admin retains its existing gold theme.
- **Fonts:** Manrope (headings, 800) + DM Sans (body) via `next/font` (self-hosted at runtime)
- **Logo:** Embedded owner-supplied artwork extracted to `public/wisdom-logo.png` and used in public and admin navigation
- **Hero:** Full-width concept photograph with a restrained navy overlay, white/lime editorial type, and mobile-first CTAs
- **Animation language (Framer Motion + CSS):**
  - Scroll-triggered staggered section reveals
  - Magnetic/hover-lift CTAs and lesson cards
  - FAQ accordion smooth height animation
  - Booking wizard progress indicators
  - Full `prefers-reduced-motion` support (CODING_RULES #20)

## 2. Information Architecture

### Public (no login)

| Route | Purpose |
|---|---|
| `/` | Home: full-width hero, trust strip, real package previews, how-it-works, photo-led approach, FAQ, CTA |
| `/lessons` | Live lesson catalogue: 90-minute, 5-pack, 8-pack and road-test packages; editable in admin |
| `/booking` | Four-step wizard: lesson → date/time → details → confirm |
| `/booking/manage` | Student self-service after email OTP: view and eligible reschedule; contact instructor to cancel |
| `/about`, `/contact` | Brand story + verified owner-supplied contact details |
| `/privacy`, `/terms`, `/accessibility` | Canadian (BC) legal pages |

### Admin (Supabase Auth at `/admin`)

| Route | Purpose |
|---|---|
| `/admin/login` | Owner/instructor sign-in (MFA-ready) |
| `/admin` | Dashboard: stat cards, today's lessons, upcoming schedule, quick actions |
| `/admin/calendar` | Advanced calendar (month / week / day) |
| `/admin/bookings` | Filterable table: confirm / complete / cancel / reschedule |
| `/admin/students` | Derived student directory |
| `/admin/lessons` | Lesson catalogue + pricing editor |
| `/admin/settings` | Weekly availability editor, blackout dates, breaks |

## 3. Data Model (Supabase / Postgres)

```
profiles           → admin users (role: owner | instructor)
lessons            → name, slug, duration_min, price_cad, features[], active, sort_order
availability_rules → weekday (0-6), start_time, end_time
blackout_dates     → date, reason (statutory holidays, vacation)
bookings           → ref (WDA-XXXXXX), lesson_id, student PII, date, start_time,
                     status (pending/confirmed/completed/cancelled/no_show),
                     price_cad, rescheduled_from, payment_status (stripe-ready), timestamps
booking_tokens     → booking_id, token_hash (SHA-256 only), expires_at, used_at
```

**Conflict prevention:** Postgres functions `create_booking()` / `reschedule_booking()` run availability + overlap checks **atomically in a transaction** — no double-booking race conditions. Client JS is never the source of truth.

## 4. Advanced Booking Calendar (admin)

Custom-built scheduling UI, independent of the public navy/lime brand treatment:

- Three views: **Month grid, Week time-grid, Day agenda** with animated transitions
- Booking chips color-coded by status
- Click day → detail drawer; click booking → action panel (confirm/complete/cancel/reschedule)
- **Drag-to-move** booking to another slot → server conflict check on drop; animates back if slot taken
- Keyboard accessible (arrow-key navigation), reduced-motion respected
- Shares the date/time-slot engine with the public booking page (single source of truth)

## 5. Booking & Reschedule Flows

**Student books (no account):**
1. Wizard collects lesson + slot + details → `POST /api/bookings` (rate-limited, honeypot, zod-validated)
2. Server calls atomic `create_booking()` → returns reference `WDA-XXXXXX` + signed **manage link**
3. Confirmation screen shows both + "Copy link"; Resend sends the same link by email

**Student changes date/time later:**
1. Opens `/booking/manage` from the site or confirmation email and verifies their email with OTP
2. Sees eligible bookings and purchases → picks a new slot from live availability → atomic re-validation → old slot freed, new locked
3. Cancellation is handled by contacting the driving instructor; students cannot cancel sessions online.

**Admin reschedules:** same atomic check from table row or calendar drag; student notified by email.

## 6. Canadian Legal (British Columbia)

- **`/privacy`:** BC PIPA + federal PIPEDA — collected data (name, email, phone, pickup area, notes), purpose (scheduling), retention (e.g. 2 years post-last-lesson then deletion), no selling data, access/correction rights, contact placeholder, last-updated date
- **`/terms`:** booking terms, cancellation/no-show policy (placeholder pending owner confirmation), L-license supervision rules, **explicit "not affiliated with ICBC" disclaimer** (no ICBC-licensed claims until confirmed), liability limits per BC Consumer Protection Act, governing law = British Columbia
- **`/accessibility`:** WCAG 2.1 AA commitment (BC Access by Design 2030)
- Linked in footer on every page; consent checkbox on booking form

## 7. Security Posture

- All DB writes via **server API routes only** — no direct anon inserts; service-role key never leaves the server
- `/admin/*` protected by middleware + Supabase session verification + role check
- Row Level Security enabled on every table (deny-by-default)
- Zod validation shared client/server; server never trusts client input
- Rate limiting + honeypot on public booking endpoint
- Booking tokens: SHA-256 hashed at rest, expiring, constant-time comparison
- Security headers in `next.config.ts` (CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy)
- `.env.example` placeholders only; no real keys or student PII in source, logs, or demo data
- Never expose private details in design JSON or client bundles

## 8. Email (Resend)

- Templates via `@react-email/components`: booking confirmation, rescheduled, cancelled, new-booking owner alert
- Missing `RESEND_API_KEY` locally → bookings still succeed, emails log to console
- Owner supplies Resend key + verified domain before production

## 9. Tech Stack

Next.js 16 · React 19 · TypeScript (strict) · Tailwind CSS 4 · Framer Motion · Supabase (DB + Auth) · Resend + React Email · Zod · Docker (deploy phase)

## 10. Build Order

Each phase: code → `npx tsc --noEmit` + `npm run lint` + `npm run build` pass → user reviews at localhost → next phase.

1. **Design system** — fonts, public navy/lime theme, owner-supplied logo, photographic hero, responsive nav/footer
2. **Public pages** — home sections, lessons, about, contact, 3 legal pages
3. **Booking engine** — schema, migrations, availability + atomic booking APIs, public wizard, manage-link page
4. **Admin** — auth, dashboard, advanced calendar, bookings/students/lessons/settings
5. **Email** — Resend templates + notifications
6. **Hardening** — security headers, rate limits, a11y + reduced-motion audit, legal copy finalization
7. **Deploy** — Docker for Hostinger/Dokploy (only after user go-ahead)

## Verification Checklist (every phase)

- [ ] `npx tsc --noEmit` — 0 errors
- [ ] `npm run lint` — 0 errors
- [ ] `npm run build` — success
- [ ] Manual flow test at `localhost:3000`
- [ ] Mobile responsive check (320px → 1440px+)
- [ ] `prefers-reduced-motion` respected
- [ ] No secrets / PII in source or client bundle

## External Setup Needed From User (Phase 3+)

- Supabase project (free tier) → `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` into `.env.local`
- Resend account + API key + verified domain → `RESEND_API_KEY`, `EMAIL_FROM`, `BOOKING_NOTIFY_EMAIL`
- Owner confirms real phone, email, service areas, cancellation policy, and whether ICBC-licensed status applies

## Booking reliability upgrade — scheduling phase deployed (2026-11-02)

- Scheduling-only implementation is committed as `bb319f152cc75b5919d260d1dd9f3b7de0fec3b1` and deployed to production through the configured Dokploy `main` auto-deploy. Broader purchase/credit changes remain local and were excluded.
- A 90-minute lesson reserves a 120-minute occupied slot while the actual saved/displayed lesson remains 90 minutes. Migration `0018_120_minute_occupied_slots.sql` and the full draft `0018`–`0021` chain executed against a fresh temporary PostgreSQL database; no Supabase/staging or production validation has occurred.
- Students cannot cancel through My Booking. They are directed to contact the instructor. Admin cancellation is retained.
- Admin completion now affects only the selected appointment; migration `0020_complete_booking_session.sql` uses a package advisory lock and synthetic PostgreSQL checks cover one-of-three completion and package-token invalidation only after all sessions are closed. Concurrent completion was not stress-tested.
- Independent buy-now/schedule-later package purchase is wired locally through Stripe Checkout, verified/idempotent webhook fulfillment, OTP purchase listing, private token access, and atomic one-credit scheduling. Six-calendar-month validity starts from verified payment; sessions remain 90 minutes while occupying 120 minutes. Admin Payments includes a protected read-only purchase, ledger-balance, and event-history view; the database rejects purchase snapshot edits and credit-ledger mutation. Purchase manage-token rotation is also transactional. Manual credit corrections/refund reconciliation, extras/review, cheque tracking, retention, and mobile/staging QA remain incomplete. Synthetic SQL checks on a fresh temporary database cover migration-chain execution, credit redemption, occupied duration, token rotation/expiry validation, and mutation guards. This feature is not ready for deployment.
- My Booking requires email OTP; its emailed manage links were previously an OTP bypass, now removed in the local upgrade branch. Sensitive licence/DOB/gender fields remain excluded pending privacy/legal review.
- Production migration `0018` was applied and recorded in Supabase migration history. It changes scheduling functions/triggers only; it did not rewrite existing booking rows. Supabase reported no backups when inspected; the user accepted the associated risk for this scheduling-only change.
- The read-only overlap audit found one pair of confirmed 90-minute appointments that overlap by 30 minutes under the new occupancy rule and no upgrade holds. Both appointments remain unchanged; new availability skips occupied times. See `reports/production-overlap-audit-2026-11-02.md`.
- Production availability was checked after deployment and excludes the 16:30 Vancouver start for a 90-minute lesson because its 120-minute occupied block would run past the 18:00 closing time. `/booking/purchase` remains 404. Stripe settings were not modified.
- The full booking-system upgrade is **not complete**. Purchase/credit, OTP/dashboard, per-session and remaining admin requirements still need a clean local branch, staged integration testing, policy decisions, review, and separate rollout approval. Do not apply migrations `0019`–`0022` or deploy the broader local work yet.

## My Booking OTP hardening — local branch work (2026-11-03)

- Confirmation/reschedule URLs now target `/booking/manage` and contain no management token. The legacy `/api/bookings/manage-link` endpoint only redirects and never issues an access cookie, so old emailed links no longer bypass OTP.
- The managed-access cookie lifetime is shortened to 30 minutes. Existing clear-on-leave behavior remains; returning after that short session requires fresh email verification.
- After successful OTP, the account list has no arbitrary 10-record slice and displays “Welcome back, [first name]!” when a verified booking or package record supplies the name.
- My Booking now has an “Add More Lessons” action that leads to the existing catalogue/independent-purchase flow. Purchase records show their purchase date, payment status and remaining credits; the management API now loads package balances by their purchase ID and returns sessions scheduled from that specific purchase.
- Regression coverage added for token-free email URLs and legacy-route no-cookie behavior. Local results: 22 security tests, TypeScript, ESLint, production build, and `git diff --check` pass. Build emits the existing `metadataBase` warning.
- This is uncommitted, local-only work on `fix/full-booking-upgrade`; it has not been tested on the live site, pushed, or deployed. Each purchase is still opened separately, so the consolidated all-active-packages dashboard and the rest of the requested upgrade are not complete.
