import test from "node:test";
import assert from "node:assert/strict";
import { validateLocalEnvironment } from "../scripts/dev-local.mjs";

const localDefaults = {
  WDA_APP_ENV: "local",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "local-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "local-service-role-key",
  STRIPE_SECRET_KEY: "sk_test_localOnly123",
  STRIPE_LIVE_PAYMENTS_ENABLED: "false",
};

test("local startup accepts loopback Supabase and Stripe Test Mode only", () => {
  assert.deepEqual(validateLocalEnvironment(localDefaults), []);
});

test("local startup blocks unset environment classification", () => {
  assert.ok(validateLocalEnvironment({}).some((error) => error.includes("WDA_APP_ENV=local")));
});

test("local startup blocks remote Supabase endpoints", () => {
  const errors = validateLocalEnvironment({
    ...localDefaults,
    NEXT_PUBLIC_SUPABASE_URL: "https://production-ref.supabase.co",
  });
  assert.ok(errors.some((error) => error.includes("loopback Supabase")));
});

test("local startup blocks Stripe live keys and live-payment opt-in", () => {
  assert.ok(validateLocalEnvironment({
    ...localDefaults,
    STRIPE_SECRET_KEY: "sk_live_notForLocal123",
  }).some((error) => error.includes("Stripe Test Mode")));
  assert.ok(validateLocalEnvironment({
    ...localDefaults,
    STRIPE_LIVE_PAYMENTS_ENABLED: "true",
  }).some((error) => error.includes("must never be enabled")));
});

test("local startup blocks external email delivery credentials", () => {
  assert.ok(validateLocalEnvironment({
    ...localDefaults,
    RESEND_API_KEY: "test-or-live-key",
  }).some((error) => error.includes("external email API key")));
});
