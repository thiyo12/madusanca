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
| `/booking/manage` | Student self-service via private link or email code: view, reschedule, cancel |
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
1. Opens `/booking/manage?token=...` (token stored hashed, expiring, revocable)
2. Sees booking → picks new slot from live availability → atomic re-validation → old slot freed, new locked
3. Or cancels (policy notice) → status `cancelled`, slot freed, cancel email sent

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
