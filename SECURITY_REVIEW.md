# Wisdom Driving Academy — Pre-launch Security Review

**Review date:** 2026-11-01
**Scope:** Source-level review guided by the attached Pre-Launch Security Toolkit (Checks 01–27).
**Mode:** Source review with follow-up hardening and read-only production verification; production database migrations and one unique OTP secret were intentionally updated as authorized below.
**Confidence:** Medium for the code findings below; low for deployment/provider settings that cannot be proven from source.

## Executive summary

The app has meaningful protections: Supabase validates admin identity server-side, RLS is deny-by-default, booking management tokens are random and stored hashed, and Stripe webhooks are signature-verified and idempotent. Deployed changes bind fulfillment to stored sessions and expected amounts, serialize OTP verification, enforce admin MFA, use shared rate limiting, reduce PII/error leakage, and add nonce-based CSP and response headers. It remains **not ready for live payments**: the exposed Supabase service-role key remains unrotated by owner choice, and several provider settings still need verification.

## Findings (ranked)

| ID | Finding | Severity | Evidence / location | Recommendation | Status |
|---|---|---:|---|---|---|
| F-01 | Supabase service-role credential exposure in prior browser-inspection output | **Critical** | Earlier browser inspection read the Dokploy environment editor and exposed `SUPABASE_SERVICE_ROLE_KEY` in tool output. This credential bypasses RLS and has broad database access. | Rotate/revoke the exposed credential in Supabase; replace it in Dokploy and redeploy. Review Supabase logs for unexpected use. Do not send the replacement in chat. | Needs owner action; explicitly declined rotation so far |
| F-02 | Stripe fulfillment must be verified against payment/session details | **High** | `src/lib/stripe/fulfill.ts`; migrations `0012`–`0013`. | Keep checks binding session, booking, CAD, and expected amount; independently verify Stripe test-mode webhook/configuration before live use. | Code fix deployed; mismatch tests pass locally; production payment flow intentionally not exercised |
| F-03 | Service-role database key is used for all booking persistence; any server-side compromise has broad read/write impact | **High** | `src/lib/booking/supabase-store.ts:25-37`; RLS is intentionally bypassed by this client. | Keep it server-only, restrict deployment access, rotate exposed key, monitor usage, ensure Supabase network/backup settings and production secrets access are least-privilege. Consider splitting capabilities if feasible. | Partially verified in code; dashboard settings open |
| F-04 | Login abuse resistance depends on configured trusted proxy IP | **High** | `src/app/admin/login/actions.ts`; shared Supabase rate-limit RPC. | Per-email shared limits and generic failures are implemented; verify trusted proxy IP configuration for per-IP limits. | Code fix deployed; proxy configuration remains unverified |
| F-05 | Per-IP rate limiting is unavailable when trusted proxy IP mode is disabled | **High** | `src/lib/server/rate-limit.ts`; shared SQL counter in migration `0011`. | Shared identity/token limits protect booking, contact, manage, OTP, and payment flows; unknown IPs no longer share a site-wide bucket. Verify Dokploy overwrites `X-Real-IP` before enabling per-IP buckets. | Identity limits deployed; trusted-proxy setting remains unverified |
| F-06 | OTP token creation follows one-time verification consumption | **High** | `src/lib/booking/supabase-store.ts`; `/api/bookings/otp`; migration `0010`. | Atomic locked verification and one-time consumption are deployed. If token creation fails after consumption, the user must request a new code. Add production-safe concurrency/replay integration tests. | Migration applied; code deployed; integration tests remain |
| F-07 | In-memory JSON/file store is selectable in non-production; it is not suitable for multi-instance deployments | **High** | `src/lib/booking/store.ts:7-25`; file store is selected when Supabase variables are missing outside production. | Ensure staging/production configuration always uses the persistent database; avoid deploying file-store mode to a multi-instance environment. | Production env looked configured by variable name only; runtime behavior untested |
| F-08 | Store methods retain provider error details internally for diagnosis | **Medium** | `src/lib/booking/supabase-store.ts`; route/action boundaries. | Public failures use generic responses and `logSafeError`; admin lesson-save errors also return a generic message. Continue auditing new call sites. | Follow-up fix deployed; continue auditing new call sites |
| F-09 | Contact endpoint may log submitted personal information when email configuration is absent | **Medium** | `src/app/api/contact/route.ts` | PII logging removed; production now fails closed when email is not configured. | Code fix added |
| F-10 | CSP permits inline style attributes for framework/UI styling | **Medium** | `src/proxy.ts`; live headers | Script execution and style elements are nonce-based; style attributes are explicitly allowed to preserve UI behavior. Consider removing inline styles if the UI can be refactored. | Deployed and live-verified; HSTS and other headers present |
| F-11 | Private manage tokens appear in query strings and API response payloads | **Medium** | Checkout success/cancel URLs and customer manage responses. | Global no-referrer and no-store rules added for manage and booking API routes. Token-in-URL design remains. | Partially fixed |
| F-12 | Security test coverage does not yet include provider-backed integration tests | **High** | `tests/security-basics.test.mjs` | Keep expanding coverage for actual auth/ownership boundaries, OTP races, shared rate limits, and Stripe webhook integration. | 15 local security tests pass; integration coverage remains open |
| F-13 | Password recovery token expiry and single-use behavior depend on Supabase configuration | **Medium** | Reset uses Supabase Auth; successful password updates call `signOut({ scope: "global" })` in `src/app/admin/login/actions.ts`. | Verify recovery-token expiry/single-use and Supabase global sign-out behavior; test used/expired links and active sessions. | Global revocation implemented; provider behavior remains unverified |
| F-14 | MFA on external control-plane accounts cannot be verified from app code | **Medium** | App admin gate enforces verified TOTP and `aal2` in `src/lib/auth/require-admin.ts`; external provider accounts remain separate. | Secure Dokploy, GitHub, domain registrar, Supabase, and Stripe accounts with MFA/passkeys; verify each provider setting. | App MFA enforcement deployed; external account settings unverified |
| F-15 | Password recovery redirect allowlist and link expiry are not verified | **Low/Medium** | `src/app/admin/login/actions.ts`; `src/app/auth/confirm/route.ts`. | Verify the exact Supabase redirect allowlist and recovery expiry; do not trust `Host` input. | Redirect is fixed to the production host in code; Supabase allowlist/provider behavior unverified |

## Check-by-check coverage (all 27)

| # | Check | Result | Evidence / remaining work |
|---:|---|---|---|
| 01 | Authentication | **Partial** | Supabase `auth.getUser()` validates identity; login has shared email/IP limits and generic failures. Signed-out admin access was verified to redirect to login. Normal-user and full action authorization tests remain. |
| 02 | Hide API keys | **Partial** | Stripe, Resend, Supabase service credentials are read in server modules; public Supabase URL/anon key are expected browser-visible values. Production bundle secret scan was not performed in this audit. Prior service-role exposure is F-01. |
| 03 | Secure database | **Partial / hardened** | Migrations enable RLS and intentionally define no client policies (deny-all); all 10 application `SECURITY DEFINER` RPCs now pin `search_path=pg_catalog` (migration `0014`, deployed and read-only verified). Actual deployed RLS/security advisor, grants, network restrictions, backups, and two-user tests were not verified. |
| 04 | HTTPS | **Partial / live checked** | HTTP redirects to HTTPS and production responses include HSTS. Certificate chain, TLS to database, and all mixed-content paths were not independently tested. |
| 05 | Hash passwords | **Provider-managed / partial** | Supabase Auth handles password storage; app does not define a password table. Reset minimum is 8 characters. Provider hashing, password policy and session revocation were not inspected. |
| 06 | Server-side validation | **Partial** | Zod schemas and bounded request bodies exist for public APIs. Audit did not prove every admin form/action is strictly validated, and many object schemas accept unknown keys by default (writes currently pick individual fields). Add a complete endpoint/action fuzz suite. |
| 07 | XSS | **Partial** | React escaped rendering is the default; the only `dangerouslySetInnerHTML` found is JSON-LD structured data in `src/components/seo/business-json-ld.tsx`, not user content. External URLs and all rendered data still need targeted tests. |
| 08 | Logging/monitoring | **Partial** | Sensitive provider messages are scrubbed from safe logs and contact PII logging was removed. Centralized alerting, request IDs, retention, and operational monitoring remain unverified. |
| 09 | Admin routes | **Partial** | Proxy and server checks validate Supabase identity and admin role; app-enforced TOTP MFA/`aal2` is implemented. Signed-out admin route redirect was verified; a normal non-admin account test was not performed. |
| 10 | Parameterized queries | **Partial** | Supabase client query builder/RPC is used; no raw SQL interpolation from application requests found. Some PostgREST `.or()` filters are assembled from sanitized search text in `supabase-store.ts:238-249`; database RPC SQL needs independent review and injection tests. |
| 11 | Environment variables | **Partial** | `.gitignore` excludes `.env*`; tracked-file check found only `.env.example` plus SQL migrations. Secret variable names are not public-prefixed except intentionally public Supabase/config values. Actual secret values were not inspected. Production env completeness/segregation remains external. |
| 12 | Rate limiting | **Partial** | Shared Supabase and identity/token-based limits, login throttles, OTP quota, and atomic OTP verification are deployed. Unknown IPs skip the shared IP bucket rather than aggregating site-wide. Dokploy proxy overwrite behavior remains unverified. |
| 13 | CORS | **No custom CORS found** | Same-origin relative API calls are used; no app-level wildcard/reflection headers found. Supabase/storage CORS settings were not checked. |
| 14 | Security headers | **Partial / live checked** | Live CSP is nonce-based for scripts and style elements; HSTS, no-referrer, frame, and MIME-sniffing headers were observed. Inline style attributes are explicitly allowed for UI styling; COOP/proxy behavior needs further review. |
| 15 | Session cookies | **Partial** | Supabase SSR cookie adapter/proxy refreshes auth cookies. Exact production cookie flags, lifetime, logout revocation, and password-reset revocation require browser/provider tests. |
| 16 | CSRF | **Partial / code hardened** | JSON mutation routes explicitly require the configured site Origin in production; server actions use framework protections and the Stripe webhook validates signatures. Unit tests cover trusted, cross-origin, and missing-origin cases; full browser/provider tests remain. |
| 17 | Password-reset links | **Partial** | Reset requests are rate-limited and use a fixed production redirect; successful reset globally signs out sessions. Provider expiry, single-use, supersession, and configured allowlist remain unverified. |
| 18 | File uploads | **Not applicable** | No upload routes/storage features found in code. Reassess if uploads are added. |
| 19 | Prices/payments | **Blocked — keep live mode disabled** | Amount/session/CAD validation is deployed, but production code rejects live Stripe keys. Stripe Tax still shows no British Columbia registration (tax will not be collected until one is added), and Webhooks has no endpoint listed. A GST/HST business tax identifier was saved in Stripe Tax Details after its required business-name field was completed; this did not create a BC tax registration. No charges were made. |
| 20 | Production debug mode | **Partial / live checked** | Sampled nonexistent routes and source-map requests returned 404; generic errors are used at reviewed boundaries. A controlled 500/error disclosure test was not performed. |
| 21 | Vulnerable dependencies | **Passed for current production dependency audit** | `npm audit --omit=dev` reported 0 vulnerabilities. This is a point-in-time registry scan, not a supply-chain provenance review. |
| 22 | Unused packages | **Open** | No unused-dependency scanner was run; avoid deleting packages without usage review. |
| 23 | Exposed files | **Partial / live checked** | Sampled `/.env`, `/.env.local`, `/.git/config`, source/config paths, and actual JS source-map URLs returned 404. This is a bounded probe, not an exhaustive exposed-file audit. |
| 24 | Git history secrets | **Open** | `gitleaks`/`trufflehog` unavailable in the environment; full history/branches/tags not scanned. The repository has a Git remote; no full-history secret conclusion is claimed. |
| 25 | Revoke compromised keys | **Open — owner action** | Service-role key exposure F-01 must be rotated. Other keys cannot be assessed by value/history without a scanner/provider review. |
| 26 | Thorough review | **Completed as source review** | This report. It is not a penetration test and cannot verify provider/host settings. |
| 27 | Security tests/report | **Partial** | 15 local security tests pass, including payment validation, origin checks, rate limiting, bounded bodies, and strict schemas. Provider-backed auth, OTP race, and webhook integration tests remain. |

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
2. Keep Stripe in test mode until the payment integrity checks are independently verified against the configured test webhook and price/tax setup; no production payment flow was exercised.
3. Confirm Supabase Auth login protections and require MFA for all admin identities; verify reset token expiry and session revocation.
4. Confirm Dokploy's trusted proxy IP behavior and configure shared rate limits; test login, OTP, booking, contact, Checkout, and upgrade limits.
5. Verify live HTTPS redirect/HSTS, Supabase RLS/security advisor, network policy/backups, Stripe Live Tax registration/webhook, and email SPF/DKIM/DMARC in provider dashboards.
6. Expand the 15 local security tests with provider-backed auth/OTP race/webhook tests; repeat exposed-file/source-map checks after infrastructure changes.

## Limitations

This review did not access or query Supabase tables, alter provider settings, inspect secret values, conduct a live penetration test, exercise production customer/payment flows, test real card charges, scan Git history with a dedicated secrets scanner, or verify Dokploy/Stripe/Supabase dashboard policies. A passing build or dependency audit is not proof that the app is secure. An independent application-security review is recommended before processing live customer payments.

## Post-deployment verification — 2026-11-01

This update supersedes earlier status notes above where they conflict:

- Supabase migrations `0009`–`0013` were applied to the linked production project and confirmed present with `supabase migration list --linked`.
- A fresh, unique `OTP_HASH_SECRET` was generated and saved in Dokploy. Its value was not displayed or inspected; Dokploy confirmed the save request succeeded and exactly one variable is configured.
- Commits `d50fca2` and `b4cf149` were pushed to `main`; Dokploy reported both deployments **done**. The latter contains a CSP fix for observed style-attribute violations.
- Read-only checks of `/`, `/booking`, `/booking/manage`, and `/admin/login` confirmed pages render. Unauthenticated `/admin/bookings` redirected to `/admin/login?next=%2Fadmin%2Fbookings`. No console errors were present on the final checked booking/manage/login pages.
- Live responses include nonce-based `script-src`, nonce-only `style-src`, `style-src-attr 'unsafe-inline'`, `Strict-Transport-Security: max-age=31536000`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, and `X-Content-Type-Options: nosniff`.
- Local checks after the CSP fix passed: 13 security tests, ESLint, TypeScript, production build, and `git diff --check`. `npm audit` previously reported zero vulnerabilities.
- Follow-up review verified HTTP-to-HTTPS redirect, common environment/source paths and sampled JavaScript source maps returning 404. Admin lesson-save failures now show a generic message instead of provider details; 13 security tests, lint, typecheck, build, dependency audit, and diff checks passed again. Commit `ffea97c` was deployed successfully.
- No booking, OTP, Checkout, payment, or admin login form was submitted during production verification; no real charges were made.
- **Critical unresolved risk:** the exposed Supabase service-role key was not rotated, per the owner's explicit decision. It remains compromised and must be treated as such. This review does not certify production safe for live payments; keep the key risk and Stripe/provider configuration under review.

## Follow-up hardening — 2026-11-01

- Commit `314a0ce` deployed shared identity/token rate limits and avoids a site-wide shared bucket when proxy IP is unknown. Per-IP limiting remains disabled unless Dokploy's `X-Real-IP` overwrite behavior is confirmed.
- Commit `2e187cc` deployed explicit configured-Origin checks on booking, contact, OTP, manage, Checkout, and upgrade POST routes. Stripe webhook handling remains signature-based.
- Migration `0014_harden_security_definer_search_path.sql` was applied to production. A read-only `pg_proc` check confirmed all 10 application `SECURITY DEFINER` RPCs have `search_path=pg_catalog`; the existing Supabase `rls_auto_enable` event trigger was already pinned there as well.
- Stripe Dashboard review: account status lists Payments and Payouts as active, but Stripe Tax says no British Columbia registration has been added and tax will not be collected until then; the Webhooks screen showed the setup prompt to add a destination, with no endpoint listed. A draft $0 invoice showed tax could not be calculated without a customer address. The business GST/HST identifier was saved to Tax Details after the owner updated the required legal business name; the identifier is not recorded here. No Stripe keys were opened, no payment settings were changed, and no payment was attempted.
- After these changes, 15 security tests, ESLint, TypeScript, production build, dependency audit (0 known vulnerabilities), and diff checks passed. Read-only booking, manage, and admin-login pages rendered with no console errors. No form or payment request was submitted.
- Remaining external items: trusted-proxy verification, a valid tax-registration decision and configuration, a configured/verified production webhook, provider-backed integration tests, and service-role key rotation (still not authorized).
