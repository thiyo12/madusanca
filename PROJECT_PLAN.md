# WISDOM DRIVING ACADEMY — MASTER PROJECT PLAN

**Version:** 1.0 • **Last updated:** 2026-10-23  
**Project:** Official Canadian driving-school website and booking management system  
**Repository:** https://github.com/thiyo12/madusanca  
**Status:** Planning and local-first build. NOT deployed or production-ready.  
**Plan rule:** This is the **single source of truth**. It can change as requirements evolve. Update this file when a decision changes, and mark features complete ONLY after testing.

## 1. Project goal

Build a premium, fast, accessible Canadian driving-school website with a REAL secure booking system and a practical administrative calendar. This is a real business product, **not a demo**. Aim for a clean Option A / starter MVP first, then add advanced capabilities in stages. Do not overengineer.

## 2. Agreed decisions

| Area | Decision |
|---|---|
| Brand (working name) | Wisdom Driving Academy; confirm official name before launch |
| Target market | Canada; exact province and city still need confirmation |
| Frontend | Next.js + React + TypeScript + Tailwind CSS |
| Backend / database | Supabase managed PostgreSQL |
| Staff login | Supabase Auth; admin-only initially; MFA required before launch |
| Student login | None initially; guest booking and secure, expiring management links |
| Payments | Stripe Checkout in CAD; test mode during development; optional for MVP launch |
| Customer emails | Confirmation and rescheduling notifications via transactional email service |
| Production host | Hostinger VPS + Dokploy; purchase only when application is tested |
| Development | OpenCode / VS Code locally, then GitHub, then deployment |
| GitHub use | Source code, safe migrations, tests, documentation and placeholder configuration ONLY |
| Budget | Lean self-built Option A; monitor expenses, never cut essential security |
| Scope control | Build reliable essentials first; advanced extras only after MVP works |

## 3. Visual design — using original reference

The owner supplied **wisdom-academy-netlify-ready.zip** containing a single HTML interactive website prototype. Use its helpful information architecture and ideas for hero, course cards, program sections and student lesson-selection/booking steps, but do NOT copy its insecure demo mechanics or present simulated appointments as real. Rebuild as clean reusable Next.js components.

**Design requirements:**
- Cinematic road / driving-related hero image, premium automotive feel.
- Dark navy, clean white and blue accents, strong typography, clear calls to action.
- Polished responsive mobile/tablet/desktop design; fast loading and SEO.
- Tasteful scroll/hover transitions, reduced-motion support and accessible color contrast.
- Public pages: Home, Courses/Lessons, About, How It Works, FAQ, Contact, Booking entry, and approved legal pages.
- Never invent official certification, testimonials, address, pricing, instructor credentials or reviews. Use clearly marked internal placeholders until the business approves real content.
- Images must be appropriately licensed.

**BookingTimes image:** Owner supplied a screenshot of the **login screen**, not a screenshot of the calendar itself. It exposed credentials. Never copy, publish, use, attempt to log in with or commit those credentials or that screenshot. Owner should rotate the exposed password. Future sanitized calendar screenshots can guide UI after being supplied locally; no dependency on the existing account.

**Reference availability:** Attached original files from the ChatGPT conversation are NOT automatically in your local OpenCode repository. If a sanitized prototype is placed locally, inspect it. Otherwise use these written requirements; do not pretend you opened unavailable files. Keep sensitive reference files out of GitHub.

## 4. Functional scope

### MVP (Option A — must be REAL and usable)
1. Professional public website, responsive and accessible.
2. Staff-only admin authentication and server-validated authorization.
3. Services and lesson durations, instructor availability and schedule exceptions.
4. Genuine student booking form with available date/time, validation and confirmation.
5. Admin calendar: day/week views initially, appointment detail/edit/cancel, instructor filtering and status indicators.
6. Reliable conflict prevention so two students cannot book the same instructor/vehicle slot.
7. Guest student rescheduling/cancellation using short-lived signed or securely stored one-time email links and policy checks.
8. Confirmation/change emails, logging and failure handling.
9. Basic security, audit history, testing, privacy and business policy pages.

### Next after MVP is tested
- Stripe Checkout with CAD prices; safe pending appointment holds; verified and idempotent Stripe webhooks, receipts/refunds.
- Month view, drag-and-drop, instructor/vehicle management, waitlist, reminders, simple reporting, lesson packages.
- Do not ship these as unfinished or fake features. Prioritize by business value.

## 5. How bookings MUST work

Availability considers instructor, service duration, opening hours, buffers, closures, already booked lessons and vehicle availability where relevant. Store timestamps in UTC and display in the school's actual Canadian IANA timezone, including daylight-saving changes.

Guest books a slot → backend validates it → database atomically reserves it with overlap protection → send confirmation. For rescheduling, validate secure token, policy and current availability; atomically move appointment and retain original slot if anything fails; update history and notify both parties. Implement rate limiting to protect public actions. Browser-only checks do not count.

For Stripe later, use secure temporary holds during checkout, confirm from signed webhooks (never from success-page redirect alone), and handle duplicates and failures safely.

## 6. Security, privacy and legal — NON-NEGOTIABLE

- **GitHub is CODE ONLY.** No real student/customer data, business-private details, database dumps, backups, uploaded private images, log exports, passwords, Supabase service-role/secret keys, Stripe secret/webhook keys, session tokens or `.env.local` files in GitHub, design JSON, docs, CI logs, issues or commits.
- `.env.example` has fake placeholders only. Real secrets live in ignored local `.env.local` or protected Dokploy environment variables. Use synthetic test data.
- Enforce RLS / least privilege on Supabase, server-side RBAC, MFA for staff, secure sessions, CSRF/XSS defenses, validation, rate limits and encrypted HTTPS transport. Rotate any exposed credential.
- Never collect real customer data or accept live payment while tests/security gates are incomplete.
- Apply relevant Canadian privacy law after identifying province, CASL marketing consent, provincial driver-education requirements, accessibility, cancellation/refund policies and business-approved Terms and Privacy Policy. Have legal text reviewed before production.
- Backup/restore and monitoring are launch requirements.

## 7. Mandatory engineering rules — for OpenCode, GPT and all developers

1. READ the current repository and this plan before editing. Understand existing flows and dependencies.
2. CONTINUE working code. Prefer small targeted edits over rewrites. Never duplicate applications, components, auth, database logic or routes.
3. NO OVERCODING: use simple maintainable components and minimal necessary dependencies.
4. NO DEAD CODE: safely remove unused functions, duplicate implementations, unreachable routes and obsolete assets only after verifying no feature depends on them.
5. NEVER casually delete data, break existing working features, overwrite applied database migrations, or introduce insecure shortcuts.
6. Every modification must be integrated, functional and regression tested. Run lint, TypeScript checks, applicable automated tests and production build; report anything not run.
7. Never claim a placeholder/demo, untested screen or TODO is working production functionality.
8. Update this living plan with verified progress after each completed milestone. Provide a concise change report and test results.
9. Keep secrets out of all output and source control. Review staged diff before any push.
10. Don't push to GitHub or deploy without owner approval.

`CODING_RULES.md` contains extended engineering standards; this master plan takes precedence if older docs conflict.

## 8. Delivery sequence — LOCAL FIRST

### Phase 1 — Foundation and polished public website (CURRENT)
- [ ] Clone repository to local development machine (existing main is intentionally planning-only).
- [ ] Inspect plan and existing files. Create ONE new Next.js/TypeScript/Tailwind app in this repository, not a nested duplicate.
- [ ] Set up project folders, reusable components, Git ignore and `.env.example` placeholders.
- [ ] Build responsive homepage, road-image hero, navigation, footer, course cards, about, booking-process explanation and clear CTA.
- [ ] Include subtle modern animations and accessibility basics; use approved or placeholder business content.
- [ ] Set up Supabase public environment placeholders only; NO real credentials committed.
- [ ] Run `npm install`, `npm run dev`, lint, typecheck and production build. Fix failures. Review responsive behavior.
- [ ] Update checked items only when verified; show owner local site for review. **NO GitHub push until approval.**

### Phase 2 — Secure Supabase foundation
- [ ] Supabase tables/migrations for staff, students, services, instructors, schedules, bookings and audit records.
- [ ] Review strict RLS, server-side authorization and secure staff provisioning; enforce MFA for launch.
- [ ] Verify authorized/unauthorized access and data minimization.

### Phase 3 — Booking MVP and admin calendar
- [ ] Actual availability and database-level conflict protection, including concurrent requests.
- [ ] Live booking form + admin day/week calendar and appointment management.
- [ ] Secure expiring guest reschedule links, policy checks and change email notifications.
- [ ] Integration tests for timezones, failures and unauthorized actions.

### Phase 4 — Payments, legal and launch readiness
- [ ] Stripe test checkout and signed webhook lifecycle if business approves in-scope.
- [ ] Confirm province, business details, terms, privacy, refund/cancellation and notification consent requirements.
- [ ] Accessibility, security, performance, backups and restoration tests.
- [ ] All applicable launch gates verified.

### Phase 5 — Push, stage and deploy (ONLY after local review)
- [ ] Review `git status`, staged diff, dependency and secret scans; create reviewed feature branch, then push and open PR.
- [ ] Purchase and secure Hostinger VPS, configure Dokploy, Docker build, restricted env vars, HTTPS/domain and backups.
- [ ] Test staging with test data; promote production only when approved. Monitor, verify rollback and restore.

## 9. Current confirmed status

- [x] Existing starter was intentionally removed for fresh local development.
- [x] Previous starter preserved in GitHub branch `backup/phase1-starter-2026-10-23`.
- [x] Master plan and coding rules maintained in repository.
- [ ] New application implemented.
- [ ] Local build tested.
- [ ] Live booking system implemented and verified.
- [ ] Production deployed.

**Today’s immediate task:** OpenCode creates and tests **Phase 1 only** locally. Do not build all future features, push code, or deploy until owner review.

## 10. Required coder completion report

Summarize: files changed, working features, any reused or safely removed code, checks and actual results, security concerns, open requirements and instructions to view on localhost. Update this plan to match reality.
