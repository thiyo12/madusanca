# Wisdom Driving Academy — Living Production Project Plan

**Updated:** 2026-10-23  
**Status:** Phase 1 — local-first development, NOT ready to launch  
**Repository:** https://github.com/thiyo12/madusanca  
**Policy:** This is an official business website, not a demo. This plan is editable at any time; checkboxes mean *verified*, never assumed.

## Product
Build a premium Canadian driving-school website with an advanced real booking system, a protected admin calendar, guest booking management via short-lived emailed links, and optional Stripe payments. Avoid misleading sample bookings, fake testimonials or invented certifications on production pages. Public content must be confirmed with the business.

## Technology decisions
- Next.js / TypeScript frontend and server routes.
- Supabase hosted PostgreSQL and Supabase Auth for staff login.
- Stripe Checkout and signed webhooks for CAD payments (test mode until launch).
- Production: Hostinger VPS with Dokploy; development: localhost.
- GitHub: **SOURCE CODE ONLY** (plus documentation, database schema/migrations and safe template config).
- Business province, timezone, service area, pricing, booking policies, official contact details and legal jurisdiction require confirmation.

## Absolutely no confidential information in GitHub
Even if the repository is private, treat every commit as potentially permanent or exposable.
- NEVER commit: Supabase database password, service_role/secret keys, Stripe secret/webhook keys, session secrets, emails/phone numbers of real students, addresses/driver-licence records, payment data, customer exports, booking database snapshots, private business documents, real credentials, token-bearing URLs, logs with personal data or production backups.
- **Public Supabase project URL and publishable keys can be safe for browser use only with strict RLS**, but prefer to leave even project-specific configuration out of code and use environment variables.
- Local secrets belong in ignored `.env.local`; deployment secrets belong in restricted Dokploy environment settings. Store backups securely outside GitHub with access controls.
- Commit `.env.example` with **placeholders only**. Store schema migrations with **no real data**. Use synthetic fixtures.
- No passwords, tokens or private account details in screenshots, screenshots' metadata, issues, PR discussions, or this plan. Immediately rotate any exposed credentials; removing a later commit alone does not undo exposure.
- Review `git status`, `git diff --cached` and secret scan before every push; require CI secret scanning before production.
- Enforce staff MFA, server-side authorization, least privilege, RLS, rate limits, secure sessions, HTTPS, backups and audit logs. GitHub access and Dokploy access must be independently protected.

## Current verified state
- [x] Repository exists; Phase 1 scaffold and README committed.
- [x] Starter includes Next.js, initial pages, preliminary Supabase login/roles, Dockerfile and placeholders.
- [ ] Local npm install, lint, typecheck, production build verified.
- [ ] Supabase RLS and authentication reviewed and tested.
- [ ] Production-strength MFA, rate limiting and other protections enforced.
- [ ] Booking engine, rescheduling, notifications and Stripe implemented.
- [ ] Canadian legal pages reviewed for actual province/business.
- [ ] Deployment and live tests completed.

**Do not collect real customer data or accept actual payments until launch gates pass.**

## Delivery workflow — always local first
### Stage 1: Local development (current)
1. Clone: `git clone https://github.com/thiyo12/madusanca.git && cd madusanca`.
2. Install Node.js 22 and run `npm install`.
3. Copy `.env.example` to `.env.local` and enter only required configuration locally. Never paste private values into chat or GitHub.
4. Run `npm run dev` and visit http://localhost:3000.
5. Run `npm run typecheck`, `npm run lint`, and `npm run build`. Fix failures before feature work.
6. Work in VS Code/OpenCode. Make small scoped changes; ensure each feature is tested.

### Stage 2: Core design and public pages
- Real brand identity and licensing claims verified with school.
- Cinematic driving/road hero, contemporary restrained animation, responsive navigation, accessibility and SEO.
- Course, pricing, instructors, FAQ, contact, legal pages; never use fake claims as actual content.

### Stage 3: Secure data and admin
- Review database migrations and RLS; server-side RBAC on every endpoint.
- Staff-only login; MFA before live operation; secure staff provisioning.
- Calendar views, instructor/service/vehicle availability, closures and conflict checking.
- Immutable event/audit records with strict access controls.

### Stage 4: Real bookings and payment
- Available slots based on actual instructors, durations, buffers and vehicle conflicts.
- Atomic reservations with expiration holds and transaction-level double-booking protection.
- Guest booking and policy-aware rescheduling through expiring single-use links.
- Email notices without leaking customer data to logs.
- Stripe Checkout: idempotent, signature-verified webhooks, paid/pending states and refund handling.
- Appointment timestamps in UTC and explicit local Canadian IANA timezone for daylight saving.

### Stage 5: Tests → GitHub → Hosting
1. Test locally: unit/integration/E2E, concurrency, auth, accessibility, mobile, performance.
2. Inspect staged files for secrets and personal data; commit to feature branch.
3. Push to GitHub, open PR, verify checks, merge to main only when safe.
4. Purchase Hostinger VPS when needed; harden firewall, SSH, Dokploy and HTTPS.
5. Configure production env variables **only in Dokploy**, separate from local/test values.
6. Set up monitored deployment, backups and restore test; staging verification before production launch.

## Launch checklist (must all pass)
- [ ] Real school details and Canadian province confirmed; qualified legal review of privacy, terms, cancellation/refunds, CASL and any provincial regulations.
- [ ] No credentials/PII committed or exposed; secret scan and dependency checks clean.
- [ ] MFA/authorization/RLS, login rate limits, secure session lifecycle verified.
- [ ] Student cannot view or modify another student's booking.
- [ ] Atomic booking/rescheduling passes concurrent requests and daylight-saving tests.
- [ ] Payment webhook signature/idempotency and reconciliation pass tests.
- [ ] Automated tests and production build pass.
- [ ] Real backups, successful restore test, monitoring, documented rollback.
- [ ] Business owner approves real pricing/content before launch.

## Change process
For any new request, update this document's date, status, decisions, scope and checklist. Do not silently treat roadmap features as already built. GitHub commits represent code changes; Supabase and Dokploy manage private production configuration separately.
