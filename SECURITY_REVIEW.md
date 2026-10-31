# Wisdom Driving Academy — Pre-launch Security Review

**Review date:** 2026-11-01
**Scope:** Source-level review guided by the attached Pre-Launch Security Toolkit (Checks 01–27).
**Mode:** Source review with follow-up application hardening; no production settings, secrets, or database records were changed.
**Confidence:** Medium for the code findings below; low for deployment/provider settings that cannot be proven from source.

## Executive summary

The app has meaningful baseline protections: Supabase validates admin identity server-side, tables use deny-by-default RLS, customer manage links are random bearer tokens stored hashed, and Stripe webhooks are signature-verified and idempotent by event ID. Follow-up source changes bind payment fulfillment to stored sessions and expected amounts, serialize OTP verification, reduce contact PII logging, make login errors more generic, and add response/security headers. It remains **not ready to switch to live payments** until the OTP migration is applied, all 27 checks are verified, shared throttling and tests are addressed, and the compromised Supabase service-role credential is rotated. Deployment/provider settings remain unverified.

## Findings (ranked)

| ID | Finding | Severity | Evidence / location | Recommendation | Status |
|---|---|---:|---|---|---|
| F-01 | Supabase service-role credential exposure in prior browser-inspection output | **Critical** | Earlier browser inspection read the Dokploy environment editor and exposed `SUPABASE_SERVICE_ROLE_KEY` in tool output. This credential bypasses RLS and has broad database access. | Rotate/revoke the exposed credential in Supabase; replace it in Dokploy and redeploy. Review Supabase logs for unexpected use. Do not send the replacement in chat. | Needs owner action; explicitly declined rotation so far |
| F-02 | Stripe fulfillment trusts the signed event's booking metadata without checking amount/currency and, for initial payments, does not require the event session ID to match the booking's stored Checkout Session | **High** | `src/lib/stripe/fulfill.ts`; `supabase/migrations/0008_booking_payment_security.sql`. | Bind fulfillment to stored session, expected booking, CAD, and expected pre-tax subtotal; equivalent checks added for package upgrades. Automated mismatch tests remain outstanding. | Code fix added; tests/staging verification outstanding |
| F-03 | Service-role database key is used for all booking persistence; any server-side compromise has broad read/write impact | **High** | `src/lib/booking/supabase-store.ts:25-37`; RLS is intentionally bypassed by this client. | Keep it server-only, restrict deployment access, rotate exposed key, monitor usage, ensure Supabase network/backup settings and production secrets access are least-privilege. Consider splitting capabilities if feasible. | Partially verified in code; dashboard settings open |
| F-04 | Login has no app-level shared rate limit; failed sign-in response contains a user-existence hint | **High** | `src/app/admin/login/actions.ts`; no limiter on `login`. | Generic failure response added. Shared/provider throttling and MFA verification remain. | Partially fixed |
| F-05 | Rate limiting is in-memory per process, and client IP is `unknown` unless trusted proxy IP mode is enabled | **High** | `src/lib/server/rate-limit.ts:1-44`; used by booking, contact, manage, OTP, Checkout, and upgrade routes. Counters reset on restart and do not coordinate across Dokploy instances. | Use a shared limiter (database/Redis/edge firewall), verify trusted proxy configuration, and test 429 behavior across instances. | Open; provider/deployment details needed |
| F-06 | OTP verification attempt increment is a read-then-write, not atomic; OTP can be verified repeatedly until token issuance deletes it | **High** | `src/lib/booking/supabase-store.ts`; `/api/bookings/otp`. | Atomic locked verification and one-time consumption for token requests added. Token creation follows consumption in a separate operation, so a transient token-creation failure requires requesting a new code. Concurrency/replay tests remain outstanding. | Partially fixed; apply `0010_atomic_otp_verification.sql` |
| F-07 | In-memory JSON/file store is selectable in non-production; it is not suitable for multi-instance deployments | **High** | `src/lib/booking/store.ts:7-25`; file store is selected when Supabase variables are missing outside production. | Ensure staging/production configuration always uses the persistent database; avoid deploying file-store mode to a multi-instance environment. | Production env looked configured by variable name only; runtime behavior untested |
| F-08 | Some server-side Supabase query errors are rethrown with provider error messages | **Medium** | Examples: `src/lib/booking/supabase-store.ts:123-153`, `178-220`, and additional store methods. Route handlers generally catch and return generic messages, but error details go to server logs. | Ensure raw database messages never reach clients; log only safe error codes/request IDs and scrub PII. | Needs broader error-path tests |
| F-09 | Contact endpoint may log submitted personal information when email configuration is absent | **Medium** | `src/app/api/contact/route.ts` | PII logging removed; production now fails closed when email is not configured. | Code fix added |
| F-10 | HTTP security headers are incomplete and CSP is permissive | **Medium** | `next.config.ts` | Production HSTS added without `includeSubDomains`; `unsafe-eval` removed outside development; no-referrer and no-store rules added for sensitive routes. Inline script/style allowances remain; verify proxy/CDN and browser flows. | Partially fixed |
| F-11 | Private manage tokens appear in query strings and API response payloads | **Medium** | Checkout success/cancel URLs and customer manage responses. | Global no-referrer and no-store rules added for manage and booking API routes. Token-in-URL design remains. | Partially fixed |
| F-12 | Security test coverage is absent | **High** | No test files or configured test runner found in the repository. Prior TypeScript/lint/build checks passed, but those are not security tests. | Add repeatable local/staging tests for authentication, admin denial, ownership/bearer-token boundaries, OTP replay/races, payments, validation, rate limits, and response headers before live launch. | Open |
| F-13 | Password recovery and session invalidation depend on Supabase dashboard behavior not verifiable in source | **Medium** | Reset uses Supabase Auth (`src/app/admin/login/actions.ts:68-107`); update-password flow at lines 110-145; no explicit session-revocation call is present. | Verify reset-token expiry/single-use and global session revocation behavior in the linked Supabase project; test used/expired links and sessions. | Needs dashboard verification |
| F-14 | Admin has no code-enforced MFA requirement | **Medium** | Admin authorization checks validated Supabase user and `ADMIN_EMAILS` / `profiles.role` in `src/lib/auth/require-admin.ts:9-60`; MFA is not required in code. | Enable/require MFA for admin identities in Supabase and secure Dokploy, GitHub, domain registrar, and Stripe with passkeys/authenticator MFA. | Owner/provider action |
| F-15 | Password reset redirect uses a fixed production host in code, but Supabase allowlist and link expiry are unknown | **Low/Medium** | `src/app/admin/login/actions.ts:22-27, 77-80`; `src/app/auth/confirm/route.ts` handles callback. | Verify exact Supabase redirect allowlist and reset expiry; do not trust `Host` input. Test production links end-to-end. | Code appears constrained; dashboard open |

## Check-by-check coverage (all 27)

| # | Check | Result | Evidence / remaining work |
|---:|---|---|---|
| 01 | Authentication | **Open / partial** | Supabase `auth.getUser()` validates identity in proxy and `requireAdmin`; server actions are individually gated. Login throttling and generic error response are missing; no automated unauthenticated-route tests. |
| 02 | Hide API keys | **Partial** | Stripe, Resend, Supabase service credentials are read in server modules; public Supabase URL/anon key are expected browser-visible values. Production bundle secret scan was not performed in this audit. Prior service-role exposure is F-01. |
| 03 | Secure database | **Partial** | Migrations enable RLS and intentionally define no client policies (deny-all); service-role server store bypasses RLS. Actual deployed RLS/security advisor, grants, network restrictions, backups, and two-user tests were not verified. |
| 04 | HTTPS | **Open** | Application generates production HTTPS reset URLs. Hosting/proxy redirect, certificate, TLS to database, and mixed-content behavior need live read-only verification. |
| 05 | Hash passwords | **Provider-managed / partial** | Supabase Auth handles password storage; app does not define a password table. Reset minimum is 8 characters. Provider hashing, password policy and session revocation were not inspected. |
| 06 | Server-side validation | **Partial** | Zod schemas and bounded request bodies exist for public APIs. Audit did not prove every admin form/action is strictly validated, and many object schemas accept unknown keys by default (writes currently pick individual fields). Add a complete endpoint/action fuzz suite. |
| 07 | XSS | **Partial** | React escaped rendering is the default; the only `dangerouslySetInnerHTML` found is JSON-LD structured data in `src/components/seo/business-json-ld.tsx`, not user content. External URLs and all rendered data still need targeted tests. |
| 08 | Logging/monitoring | **Open** | Console logging is used; no central structured security-event logger, request IDs, alerting, retention policy, or redaction verification found. Contact logs PII (F-09). |
| 09 | Admin routes | **Partial** | `/admin` proxy and server `requireAdmin()` use validated Supabase identity plus server-side allowlist/profile role. Actions call the helper. MFA and exhaustive signed-out/normal-user endpoint tests are absent. |
| 10 | Parameterized queries | **Partial** | Supabase client query builder/RPC is used; no raw SQL interpolation from application requests found. Some PostgREST `.or()` filters are assembled from sanitized search text in `supabase-store.ts:238-249`; database RPC SQL needs independent review and injection tests. |
| 11 | Environment variables | **Partial** | `.gitignore` excludes `.env*`; tracked-file check found only `.env.example` plus SQL migrations. Secret variable names are not public-prefixed except intentionally public Supabase/config values. Actual secret values were not inspected. Production env completeness/segregation remains external. |
| 12 | Rate limiting | **Open** | Per-process memory limiter and database OTP-send quota exist. No shared IP limiter; proxy IP trust depends on config; login and OTP verification are not robustly shared/atomic. |
| 13 | CORS | **No custom CORS found** | Same-origin relative API calls are used; no app-level wildcard/reflection headers found. Supabase/storage CORS settings were not checked. |
| 14 | Security headers | **Partial** | X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy and CSP are configured. HSTS/COOP absent in app config; CSP allows inline/eval; verify headers at proxy/CDN. |
| 15 | Session cookies | **Partial** | Supabase SSR cookie adapter/proxy refreshes auth cookies. Exact production cookie flags, lifetime, logout revocation, and password-reset revocation require browser/provider tests. |
| 16 | CSRF | **Partial** | Next.js Server Actions supply framework origin protections; JSON mutation routes use same-origin frontend and no permissive CORS was found. No explicit Origin/content-type enforcement or CSRF tests found. Webhook signature validation is appropriate. |
| 17 | Password-reset links | **Partial** | Supabase manages reset token creation; app sets configured/fixed redirect target. Expiry, single-use, supersession, rate limiting, no-referrer, and session revocation are provider/config-dependent and untested. |
| 18 | File uploads | **Not applicable** | No upload routes/storage features found in code. Reassess if uploads are added. |
| 19 | Prices/payments | **Open — launch blocker** | Server calculates checkout amounts from stored lesson/booking prices; Stripe webhook signature is verified on raw bounded body; webhook event IDs are idempotent. Missing amount/currency and initial stored-session binding checks are F-02. Live tax/webhook configuration not verified. |
| 20 | Production debug mode | **Partial** | Next.js production build is used in prior validation; routes generally return generic messages. Full public 404/500/source-map/error leak check was not run against production. |
| 21 | Vulnerable dependencies | **Passed for current production dependency audit** | `npm audit --omit=dev` reported 0 vulnerabilities. This is a point-in-time registry scan, not a supply-chain provenance review. |
| 22 | Unused packages | **Open** | No unused-dependency scanner was run; avoid deleting packages without usage review. |
| 23 | Exposed files | **Open** | `.gitignore` excludes local env/private data, but public deployment paths and source maps were not requested/tested against live host. No `check-exposed.sh` currently exists. |
| 24 | Git history secrets | **Open** | `gitleaks`/`trufflehog` unavailable in the environment; full history/branches/tags not scanned. The repository has a Git remote; no full-history secret conclusion is claimed. |
| 25 | Revoke compromised keys | **Open — owner action** | Service-role key exposure F-01 must be rotated. Other keys cannot be assessed by value/history without a scanner/provider review. |
| 26 | Thorough review | **Completed as source review** | This report. It is not a penetration test and cannot verify provider/host settings. |
| 27 | Security tests/report | **Open** | Build/lint/typecheck are not attack-oriented tests. Automated security test coverage is still needed. |

## Security-positive controls observed

- Admin identity is validated through Supabase Auth `getUser()` and role/allowlist checks execute server-side.
- Booking management tokens use 32 random bytes, SHA-256 hashes at rest, 30-day expiry, and token rotation on reschedule.
- OTPs use a cryptographic random generator, 10-minute expiry and a database send quota; atomic verification requires migration `0010_atomic_otp_verification.sql`.
- Booking/checkout/upgrade/contact JSON bodies have bounded sizes and Zod validation.
- Booking prices are sourced server-side from the lesson catalogue/stored booking, not client-supplied price values.
- Stripe webhook signature is verified from the raw request body; processed event IDs are persisted for idempotency.
- Supabase migration SQL enables RLS with no client policies for the app's sensitive tables; RPC execution is generally restricted to `service_role`.
- No application file-upload or AI/LLM feature was found.
- `npm audit --omit=dev` returned zero known production dependency advisories; prior local TypeScript, lint and production build were reported passing after fixes to the current worktree.

## Backup and changed files

- Source backup created at `../madusanca-source-backup-20261101.tar.gz` (3.6 MB). It excludes Git history, `.env*`, dependency/build output, `.data`, and common local/private-data directories.
- Source hardening was applied after the initial audit; existing uncommitted feature work remains preserved.
- Existing uncommitted work was present before this audit and was preserved.

## Actions required before launch / Live Stripe

1. **Rotate the exposed Supabase service-role credential**, update Dokploy, redeploy, and review Supabase audit/log activity. Do not paste credentials into chat.
2. Approve and implement the payment integrity checks in F-02, including tests and a migration if needed. Keep Stripe in test mode until verified.
3. Confirm Supabase Auth login protections and require MFA for all admin identities; verify reset token expiry and session revocation.
4. Confirm Dokploy's trusted proxy IP behavior and configure shared rate limits; test login, OTP, booking, contact, Checkout, and upgrade limits.
5. Verify live HTTPS redirect/HSTS, Supabase RLS/security advisor, network policy/backups, Stripe Live Tax registration/webhook, and email SPF/DKIM/DMARC in provider dashboards.
6. Add automated security tests and run exposed-file/source-map checks only against an authorized staging deployment.

## Limitations

This review did not access or query Supabase tables, alter provider settings, inspect secret values, conduct a live penetration test, exercise production customer/payment flows, test real card charges, scan Git history with a dedicated secrets scanner, or verify Dokploy/Stripe/Supabase dashboard policies. A passing build or dependency audit is not proof that the app is secure. An independent application-security review is recommended before processing live customer payments.
