import test from "node:test";
import assert from "node:assert/strict";
import { generateToken, hashToken, isValidTokenFormat, tokensMatch } from "../src/lib/booking/tokens.ts";
import { generateOtpCode, hashOtp } from "../src/lib/booking/otp.ts";
import { readBoundedBody } from "../src/lib/server/read-bounded-body.ts";
import { clientIp, isIpRateLimitedShared, isRateLimited } from "../src/lib/server/rate-limit.ts";
import {
  hasConsistentCadTotal,
  matchesInitialBookingPayment,
  matchesUpgradeBookingPayment,
  isTestModeStripeSecretKey,
} from "../src/lib/stripe/payment-validation.ts";
import { logSafeError } from "../src/lib/server/safe-log.ts";
import {
  availabilityQuerySchema,
  createBookingSchema,
  dateOnlySchema,
  isoDateTimeSchema,
  manageSchema,
} from "../src/lib/validation/booking.ts";
import { contactSchema } from "../src/lib/validation/contact.ts";
import { hasTrustedRequestOrigin } from "../src/lib/server/request-origin.ts";

test("manage tokens are random URL-safe values and only the hash should be persisted", () => {
  const token = generateToken();
  assert.equal(isValidTokenFormat(token), true);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(hashToken(token).length, 64);
  assert.notEqual(hashToken(token), token);
  assert.equal(tokensMatch(token, token), true);
  assert.equal(tokensMatch(token, `${token}x`), false);
});

test("OTP generation is six digits and hashes bind case-insensitively to email", () => {
  const code = generateOtpCode();
  assert.match(code, /^\d{6}$/);
  assert.equal(hashOtp(" STUDENT@example.com ", code), hashOtp("student@example.com", code));
  assert.notEqual(hashOtp("other@example.com", code), hashOtp("student@example.com", code));
});

test("OTP hashes use the configured server-side HMAC secret", () => {
  const previous = process.env.OTP_HASH_SECRET;
  const previousNodeEnv = process.env.NODE_ENV;
  try {
    process.env.OTP_HASH_SECRET = "first-independent-secret-value-0001";
    const first = hashOtp("student@example.com", "123456");
    process.env.OTP_HASH_SECRET = "second-independent-secret-value-0002";
    assert.notEqual(hashOtp("student@example.com", "123456"), first);
    process.env.OTP_HASH_SECRET = "too-short";
    assert.throws(() => hashOtp("student@example.com", "123456"), /at least 32 bytes/);
    delete process.env.OTP_HASH_SECRET;
    process.env.NODE_ENV = "production";
    assert.throws(() => hashOtp("student@example.com", "123456"), /must be configured/);
  } finally {
    if (previous === undefined) delete process.env.OTP_HASH_SECRET;
    else process.env.OTP_HASH_SECRET = previous;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test("bounded body rejects declared and streamed oversized bodies", async () => {
  const declared = new Request("https://example.test", {
    method: "POST",
    headers: { "content-length": "10" },
    body: "1234567890",
  });
  assert.deepEqual(await readBoundedBody(declared, 5), { ok: false });

  const streamed = new Request("https://example.test", {
    method: "POST",
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("123"));
        controller.enqueue(new TextEncoder().encode("456"));
        controller.close();
      },
    }),
    // Deliberately omit Content-Length to exercise streamed-size enforcement.
    duplex: "half",
  });
  assert.deepEqual(await readBoundedBody(streamed, 5), { ok: false });
});

test("rate limiter allows the configured number and rejects the next hit", () => {
  const key = `security-test:${crypto.randomUUID()}`;
  assert.equal(isRateLimited(key, 2, 60_000), false);
  assert.equal(isRateLimited(key, 2, 60_000), false);
  assert.equal(isRateLimited(key, 2, 60_000), true);
});

test("client IP trusts X-Real-IP only when explicitly configured", () => {
  const previous = process.env.TRUST_PROXY_IP;
  const request = new Request("https://example.test", { headers: { "x-real-ip": "203.0.113.10" } });
  try {
    delete process.env.TRUST_PROXY_IP;
    assert.equal(clientIp(request), "unknown");
    process.env.TRUST_PROXY_IP = "true";
    assert.equal(clientIp(request), "203.0.113.10");
    assert.equal(clientIp(new Request("https://example.test", { headers: { "x-real-ip": "::::" } })), "unknown");
  } finally {
    if (previous === undefined) delete process.env.TRUST_PROXY_IP;
    else process.env.TRUST_PROXY_IP = previous;
  }
});

test("unknown client IP skips its bucket instead of sharing a global limit", async () => {
  const previous = process.env.TRUST_PROXY_IP;
  try {
    delete process.env.TRUST_PROXY_IP;
    assert.equal(
      await isIpRateLimitedShared(new Request("https://example.test"), "security-test-ip", 1, 60_000),
      false,
    );
  } finally {
    if (previous === undefined) delete process.env.TRUST_PROXY_IP;
    else process.env.TRUST_PROXY_IP = previous;
  }
});

test("mutation origin validation rejects cross-origin and missing production origins", () => {
  const previousSite = process.env.NEXT_PUBLIC_SITE_URL;
  const previousNodeEnv = process.env.NODE_ENV;
  try {
    process.env.NEXT_PUBLIC_SITE_URL = "https://wisdomdrivingacademy.com";
    process.env.NODE_ENV = "production";
    assert.equal(hasTrustedRequestOrigin(new Request("https://wisdomdrivingacademy.com/api", {
      method: "POST", headers: { origin: "https://wisdomdrivingacademy.com" },
    })), true);
    assert.equal(hasTrustedRequestOrigin(new Request("https://wisdomdrivingacademy.com/api", {
      method: "POST", headers: { origin: "https://attacker.example" },
    })), false);
    assert.equal(hasTrustedRequestOrigin(new Request("https://wisdomdrivingacademy.com/api", { method: "POST" })), false);
  } finally {
    if (previousSite === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previousSite;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test("Stripe totals must reconcile exactly to subtotal plus tax", () => {
  const session = { amount_subtotal: 12000, amount_total: 13200, total_details: { amount_tax: 1200 } };
  assert.equal(hasConsistentCadTotal(session), true);
  assert.equal(hasConsistentCadTotal({ ...session, amount_total: 13199 }), false);
  assert.equal(hasConsistentCadTotal({ ...session, total_details: { amount_tax: null } }), false);
});

test("production payment gate accepts test keys and rejects live or malformed keys", () => {
  assert.equal(isTestModeStripeSecretKey("sk_test_1234567890"), true);
  assert.equal(isTestModeStripeSecretKey("rk_test_1234567890"), true);
  assert.equal(isTestModeStripeSecretKey("sk_live_1234567890"), false);
  assert.equal(isTestModeStripeSecretKey(undefined), false);
  assert.equal(isTestModeStripeSecretKey("sk_test_bad-value"), false);
});

test("paid initial Checkout must match the stored booking, session, CAD price, and total", () => {
  const booking = {
    id: "booking-123",
    reference: "WDA-ABC123",
    priceCad: 120,
    stripeCheckoutSessionId: "cs_test_123",
  };
  const session = {
    id: "cs_test_123",
    mode: "payment",
    currency: "cad",
    client_reference_id: "WDA-ABC123",
    metadata: { booking_id: "booking-123", booking_reference: "WDA-ABC123" },
    amount_subtotal: 12000,
    amount_total: 13200,
    total_details: { amount_tax: 1200 },
  };
  assert.equal(matchesInitialBookingPayment(session, booking), true);
  assert.equal(matchesInitialBookingPayment({ ...session, id: "cs_other" }, booking), false);
  assert.equal(matchesInitialBookingPayment({ ...session, amount_subtotal: 1 }, booking), false);
  assert.equal(matchesInitialBookingPayment({ ...session, currency: "usd" }, booking), false);
  assert.equal(matchesInitialBookingPayment({ ...session, client_reference_id: "WDA-OTHER" }, booking), false);
  assert.equal(matchesInitialBookingPayment({ ...session, amount_total: 13199 }, booking), false);
  assert.equal(matchesInitialBookingPayment(session, { ...booking, stripeCheckoutSessionId: undefined }), false);
});

test("paid package upgrade must match stored session and complete upgrade metadata", () => {
  const booking = {
    id: "booking-123",
    reference: "WDA-ABC123",
    stripeUpgradeCheckoutSessionId: "cs_upgrade_123",
    stripeUpgradeTargetLessonId: "package-10",
    stripeUpgradeTargetLessonName: "10 Lesson Package",
    stripeUpgradeTargetDurationMin: 60,
    stripeUpgradeTargetPriceCad: 900,
    stripeUpgradeFromPriceCad: 300,
    stripeUpgradeAmountCad: 600,
  };
  const session = {
    id: "cs_upgrade_123",
    mode: "payment",
    currency: "cad",
    client_reference_id: "WDA-ABC123",
    metadata: {
      checkout_kind: "package_upgrade",
      booking_id: "booking-123",
      booking_reference: "WDA-ABC123",
      target_lesson_id: "package-10",
      target_lesson_name: "10 Lesson Package",
      target_duration_min: "60",
      target_price_cad: "900",
      from_price_cad: "300",
    },
    amount_subtotal: 60000,
    amount_total: 66000,
    total_details: { amount_tax: 6000 },
  };
  assert.equal(matchesUpgradeBookingPayment(session, booking), true);
  assert.equal(matchesUpgradeBookingPayment({ ...session, id: "cs_other" }, booking), false);
  assert.equal(matchesUpgradeBookingPayment({ ...session, amount_subtotal: 1 }, booking), false);
  assert.equal(matchesUpgradeBookingPayment({ ...session, currency: "usd" }, booking), false);
  assert.equal(matchesUpgradeBookingPayment({
    ...session,
    metadata: { ...session.metadata, target_lesson_id: "different-package" },
  }, booking), false);
  assert.equal(matchesUpgradeBookingPayment({
    ...session,
    metadata: { ...session.metadata, checkout_kind: "initial" },
  }, booking), false);
  assert.equal(matchesUpgradeBookingPayment({ ...session, amount_total: 65999 }, booking), false);
});

test("safe error logging never emits provider error messages", () => {
  const original = console.error;
  let logged;
  console.error = (...args) => { logged = args; };
  try {
    logSafeError("test", { name: "ApiError", code: "safe_code", message: "sensitive customer detail" });
  } finally {
    console.error = original;
  }
  assert.deepEqual(logged, ["test", { name: "ApiError", code: "safe_code" }]);
});

test("date and timestamp schemas reject impossible or non-ISO values", () => {
  assert.equal(dateOnlySchema.safeParse("2028-02-29").success, true);
  assert.equal(dateOnlySchema.safeParse("2027-02-29").success, false);
  assert.equal(dateOnlySchema.safeParse("2027-13-01").success, false);
  assert.equal(isoDateTimeSchema.safeParse("2027-03-10T18:00:00.000Z").success, true);
  assert.equal(isoDateTimeSchema.safeParse("March 10, 2027").success, false);
});

test("public booking and contact schemas reject unexpected input fields", () => {
  assert.equal(availabilityQuerySchema.safeParse({ lessonId: "lesson-1", surprise: true }).success, false);
  assert.equal(manageSchema.safeParse({ action: "get", token: "should-not-be-accepted" }).success, false);
  assert.equal(createBookingSchema.safeParse({ lessonId: "lesson-1", surprise: true }).success, false);
  assert.equal(contactSchema.safeParse({ name: "Student Name", email: "student@example.com", message: "Please call me back", consent: true, surprise: true }).success, false);
});
