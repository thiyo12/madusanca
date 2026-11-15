# Isolated Dokploy staging setup

This configuration is intended for a **separate Dokploy application** built from `feat/security-remediation-local`. Nothing here deploys or changes production. Do not point it at production services. Do not run Supabase migrations against production.

## Local configuration review

- `Dockerfile.staging` builds and serves the app using the repository's `npm run build` / `npm run start` scripts on port 3000.
- Public Supabase URL/key and site-origin variables are build arguments because Next.js embeds `NEXT_PUBLIC_*` values into browser assets. They must be the **staging project's** URL and anon/publishable key. The service-role key, Stripe secret, webhook secret, OTP HMAC secret, and email API key are runtime-only Dokploy secrets; never pass them as Docker build args.
- `.dockerignore` excludes local env files, `.data`, Git, and dependencies from the build context.
- No GitHub workflow, Dokploy config, or Compose file exists in this repository. Keep production's existing GitHub `main` integration unchanged.

## 1. Create isolated dependencies (owner action)

1. Create a new Supabase project dedicated to staging, in the desired region. Do not clone production data. Use synthetic records only.
2. In the staging project's SQL editor, apply the repository migrations only after reviewing the duplicate `0058` state and preparing a validated forward-only migration plan. Do not use `supabase db push` until the linked project is positively verified as staging.
3. Create two synthetic student accounts and a separate synthetic administrator. Configure Auth redirect URLs only for the staging domain. Enable email confirmation and TOTP MFA for the administrator; set short, appropriate test session durations if desired.
4. Create a Stripe sandbox/test environment. Configure a webhook endpoint at `https://<staging-host>/api/stripe/webhook` for the event types required by the application. Obtain only test-mode secret and webhook signing values.
5. Create a dedicated test-email provider/API key and sender. Restrict recipients to controlled test inboxes or use the provider's test/sandbox mode. Do not reuse production Resend credentials or send to real customers.

## 2. Create a separate Dokploy application

1. In Dokploy, create a **new application** (not a new deployment target inside the production app). Name it clearly as WDA staging.
2. Connect the existing GitHub repository, select branch `feat/security-remediation-local`, and set the build context to repository root and Dockerfile path to `Dockerfile.staging`.
3. Do not add this application to the production app's deployment hooks, domain, volumes, databases, or environment groups. Do not change the production app's branch (`main`). Ensure the staging GitHub integration can trigger only this staging app; disable any production deploy webhook/token from staging settings.
4. Set the container port to `3000`. Attach a staging-only hostname and TLS certificate. Do not reuse production hostnames or persistent volumes.
5. Set the following **build arguments** using staging values only:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_SITE_URL=https://<staging-host>`
   - `NEXT_PUBLIC_CANONICAL_ORIGIN=https://<staging-host>`
   - `NEXT_PUBLIC_SEO_INDEXING_ENABLED=false`
6. Set these as **runtime secrets/environment values** (never build args):
   - `SUPABASE_SERVICE_ROLE_KEY` — staging project only
   - `STRIPE_SECRET_KEY` — Stripe test-mode key only (`sk_test_…` or restricted `rk_test_…`)
   - `STRIPE_WEBHOOK_SECRET` — signing secret for the staging webhook only (`whsec_…`)
   - `OTP_HASH_SECRET` — independently generated high-entropy staging-only random secret (at least 32 bytes)
   - `RESEND_API_KEY` — test-only email API key
   - `EMAIL_FROM` — verified staging/test sender
   - `BOOKING_NOTIFY_EMAIL` — controlled test inbox
   - `ADMIN_EMAILS` — synthetic staging admin address(es) only
   - `ADMIN_REQUIRE_MFA=true`
   - `STRIPE_LIVE_PAYMENTS_ENABLED=false`
   - `TRUST_PROXY_IP=false` unless the staging reverse proxy is confirmed to overwrite `X-Real-IP`
   - `STRIPE_DRIVING_LESSON_TAX_CODE` — only if needed for the tested staging flow and configured for the test account
7. Keep all variables scoped to this Dokploy app. Never copy production env groups, Docker secrets, database URLs, or backups. In Stripe, confirm the account mode says **test/sandbox** before creating keys/webhooks. The app's payment gate must reject live keys when live payments are disabled.
8. Configure Dokploy's app-level access control or put staging behind an authenticated reverse-proxy/VPN/allowlist. Do not assume `robots.txt` is access control. Keep SEO indexing false; confirm `/robots.txt` disallows all and the page carries noindex. Consider an additional `X-Robots-Tag: noindex` at the staging proxy.
9. Deploy only after reviewing the rendered build args and runtime environment names/values locally in Dokploy. Verify the container logs contain no secret values. Test that staging can reach only its own Supabase project and that staging checkout is in test mode.

## 3. Isolation checks before security tests

- Confirm the public Supabase URL in the staging page bundle is the staging project URL; confirm the service-role key is absent from all browser assets and image build history.
- Confirm no production credentials, production database connection, production email sender/key, or production Stripe key is present in the staging app.
- Verify the staging domain cannot invoke a production deploy webhook and that the production app remains connected to `main`.
- Use only synthetic accounts/data. Do not import production data or customer identifiers.
- Record the staging project reference (not credentials), app URL, deployed commit, and configuration owner for test evidence.

## 4. Tests to run once staging is available

Use two independent synthetic students. Test cross-student booking lookup, history, reschedule/cancel attempts, tampered IDs and expired tokens; OTP expiry/replay/rate limits; admin/non-admin authorization, MFA, session expiry and logout; Stripe invalid-signature and duplicate-event replay, altered price and failed payment; and simultaneous booking/reschedule conflicts. Record each result separately. None of these integration tests has been run by this repository configuration change.

## 5. Owner-only read-only production checklist (separate from staging)

Do not change production while completing these checks:

- **Supabase:** project reference; migration ledger including both `0058` entries; Security Advisor; RLS enabled state/effective policies/grants; exposed schemas; `SECURITY DEFINER` RPC grants/search paths; Auth confirmation, MFA, redirect allowlist, session/JWT and password-reset settings.
- **Dokploy/VPS:** production app branch and Git integration (`main`); deploy hooks/tokens and who can invoke them; secret scoping; app/container privilege; public ports/reverse proxy/TLS; VPS OS updates; SSH key-only access/root login; firewall; database network exposure.
- **Backups/retention:** encryption/access, schedule, restore evidence, backup/log/provider retention, deletion/anonymization process and legal/tax/dispute exceptions, and when deleted records expire from backups.
- **GitHub:** repository membership/2FA, branch protections, workflow token permissions, environment approvals, deploy credentials/webhooks, secret scanning.

Capture sanitized outcomes only; never paste or print secret values.

## Current limitations

No staging Supabase project, Stripe sandbox credentials, test email configuration, Dokploy access, or staging hostname is available in this checkout. No external resources have been created, and no deployment/integration tests have been performed. The duplicate migration's safe forward correction remains blocked on the actual applied migration ledger.
