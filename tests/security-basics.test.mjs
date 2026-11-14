import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateToken, hashToken, isValidTokenFormat, tokensMatch } from "../src/lib/booking/tokens.ts";
import { generateOtpCode, hashOtp, otpExpiry, OTP_TTL_MIN } from "../src/lib/booking/otp.ts";
import { readBoundedBody } from "../src/lib/server/read-bounded-body.ts";
import { clientIp, isIpRateLimitedShared, isRateLimited } from "../src/lib/server/rate-limit.ts";
import {
  hasConsistentCadTotal,
  matchesInitialBookingPayment,
  matchesUpgradeBookingPayment,
  matchesPackagePurchasePayment,
  isStripePaymentsEnabled,
  isTestModeStripeSecretKey,
} from "../src/lib/stripe/payment-validation.ts";
import { logSafeError } from "../src/lib/server/safe-log.ts";
import {
  availabilityQuerySchema,
  createBookingSchema,
  dateOnlySchema,
  isoDateTimeSchema,
  manageSchema,
  otpSchema,
  packagePurchaseSchema,
} from "../src/lib/validation/booking.ts";
import { contactSchema } from "../src/lib/validation/contact.ts";
import { hasTrustedRequestOrigin } from "../src/lib/server/request-origin.ts";
import { createStudentBookingPdf } from "../src/lib/admin/student-booking-pdf.ts";
import { customerCanAccessBooking } from "../src/lib/booking/customer-access.ts";
import { addMonthsToKey, dayKeyOf, formatSlotTime } from "../src/lib/booking/format.ts";
import { generateSlots, HORIZON_DAYS, occupiedDurationMin, toVancouverDayKey, toVancouverParts, zonedToUtc } from "../src/lib/booking/slots.ts";
import { manageUrl } from "../src/lib/booking/urls.ts";
import { isInsideSelfServiceWindow, MAX_STUDENT_RESCHEDULES_PER_SESSION } from "../src/lib/booking/manage-policy.ts";
import { isLocalAdminBypassEnabled } from "../src/lib/auth/local-admin-bypass.ts";
import { TUTOR_REPORT_ITEMS, TUTOR_REPORT_RUBRIC } from "../src/lib/admin/tutor-report-rubric.ts";
import { studentSessionsComplete } from "../src/lib/admin/student-record-format.ts";

test("manage tokens are random URL-safe values and only the hash should be persisted", () => {
  const token = generateToken();
  assert.equal(isValidTokenFormat(token), true);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(hashToken(token).length, 64);
  assert.notEqual(hashToken(token), token);
  assert.equal(tokensMatch(token, token), true);
  assert.equal(tokensMatch(token, `${token}x`), false);
});

test("booking email links omit management tokens and legacy links cannot set an access cookie", () => {
  const previousSite = process.env.NEXT_PUBLIC_SITE_URL;
  try {
    process.env.NEXT_PUBLIC_SITE_URL = "https://wisdomdrivingacademy.com";
    const emailUrl = manageUrl();
    assert.equal(emailUrl, "https://wisdomdrivingacademy.com/booking/manage");
    assert.equal(emailUrl.includes("sensitive-manage-token-value"), false);
    const legacyRoute = readFileSync(new URL("../src/app/api/bookings/manage-link/route.ts", import.meta.url), "utf8");
    assert.match(legacyRoute, /return redirectToManage\(\)/);
    assert.doesNotMatch(legacyRoute, /cookies\.set|set\(MANAGE_COOKIE_NAME/);
  } finally {
    if (previousSite === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previousSite;
  }
});

test("OTP generation is six digits and hashes bind case-insensitively to email", () => {
  const code = generateOtpCode();
  assert.match(code, /^\d{6}$/);
  assert.equal(hashOtp(" STUDENT@example.com ", code), hashOtp("student@example.com", code));
  assert.notEqual(hashOtp("other@example.com", code), hashOtp("student@example.com", code));
});

test("OTP expiration is exactly 10 minutes and resend is delayed until that expiry", () => {
  const issuedAt = new Date("2026-11-04T12:00:00.000Z");
  assert.equal(OTP_TTL_MIN, 10);
  assert.equal(Date.parse(otpExpiry(issuedAt)) - issuedAt.getTime(), 10 * 60_000);
  const otpRoute = readFileSync(new URL("../src/app/api/bookings/otp/route.ts", import.meta.url), "utf8");
  const resendMigration = readFileSync(new URL("../supabase/migrations/0038_ten_minute_otp_resend_cooldown.sql", import.meta.url), "utf8");
  const fileStore = readFileSync(new URL("../src/lib/booking/file-store.ts", import.meta.url), "utf8");
  const bookingFind = readFileSync(new URL("../src/components/booking/booking-find.tsx", import.meta.url), "utf8");
  const dailyLimitMigration = readFileSync(new URL("../supabase/migrations/0045_otp_daily_send_limit_fifteen.sql", import.meta.url), "utf8");
  const dailyLimitConstraintMigration = readFileSync(new URL("../supabase/migrations/0046_otp_send_count_check_fifteen.sql", import.meta.url), "utf8");
  const latestCooldownMigration = readFileSync(new URL("../supabase/migrations/0058_enforce_ten_minute_otp_resend_cooldown.sql", import.meta.url), "utf8");
  assert.match(otpRoute, /expiresAt,/);
  assert.match(otpRoute, /verifyOtp\(email, hashOtp\(email, code \?\? ""\)\)/);
  assert.doesNotMatch(otpRoute, /action === "token"\);/);
  assert.match(fileStore, /cooldownMs = OTP_TTL_MIN \* 60 \* 1000/);
  assert.match(fileStore, /limit\.sends >= 15/);
  assert.match(dailyLimitMigration, /v_limit\.send_count >= 15/);
  assert.match(dailyLimitConstraintMigration, /check \(send_count between 0 and 15\)/);
  assert.match(otpRoute, /studentName: target\?\.studentName \?\? purchaseTarget\?\.studentName \?\? "there"/);
  assert.match(otpRoute, /studentEmail: target\?\.email \?\? purchaseTarget\?\.email \?\? email/);
  assert.match(otpRoute, /if \(found\.length === 0 && purchases\.length === 0\)/);
  assert.match(otpRoute, /If a booking or package purchase exists for that email, a code has been sent or may still be active/);
  assert.ok(otpRoute.indexOf("if (found.length === 0 && purchases.length === 0)") < otpRoute.indexOf("await store.putOtp(email, otpHash, expiresAt)"));
  assert.match(otpRoute, /sendLimitReason: "daily_limit"/);
  assert.match(bookingFind, /result\.sendLimitReason === "daily_limit"/);
  assert.match(bookingFind, /expiry - Date\.now\(\) > OTP_TTL_MS/);
  assert.match(bookingFind, /retryAfter > 0 && !readPendingOtp\(email\)/);
  assert.match(bookingFind, /readPendingOtp\(email\) \? "Enter current code"/);
  assert.match(bookingFind, /localStorage\.setItem\(PENDING_OTP_KEY, JSON\.stringify\(\{ email: email\.trim\(\)\.toLowerCase\(\), expiresAt:/);
  assert.match(resendMigration, /last_sent_at \+ interval '10 minutes'/);
  assert.match(latestCooldownMigration, /last_sent_at \+ interval '10 minutes'/);
  assert.match(latestCooldownMigration, /pg_advisory_xact_lock/);
  assert.doesNotMatch(resendMigration, /interval '2 minutes'/);
});

test("expired lessons do not offer online payment", () => {
  const bookingFind = readFileSync(new URL("../src/components/booking/booking-find.tsx", import.meta.url), "utf8");
  assert.match(bookingFind, /booking\.canOpen && booking\.paymentStatus === "due" && isUpcoming/);
});

test("the 48-hour reschedule cutoff applies independently to each package session", () => {
  const now = Date.parse("2026-11-04T12:00:00.000Z");
  const sessions = [
    "2026-11-05T11:00:00.000Z", // today's/next-day lesson: blocked
    "2026-11-06T12:00:00.000Z", // exactly 48 hours: eligible
    "2026-11-10T12:00:00.000Z",
  ];
  assert.deepEqual(sessions.map((startsAt) => isInsideSelfServiceWindow(startsAt, now)), [true, false, false]);
});

test("My Booking adds packages inline and reuses the booking calendar for eligible reschedules", () => {
  const finder = readFileSync(new URL("../src/components/booking/booking-find.tsx", import.meta.url), "utf8");
  const manage = readFileSync(new URL("../src/components/booking/booking-manage.tsx", import.meta.url), "utf8");
  const dateTime = readFileSync(new URL("../src/components/booking/date-time-step.tsx", import.meta.url), "utf8");
  const packageCheckout = readFileSync(new URL("../src/components/booking/stripe-package-purchase-button.tsx", import.meta.url), "utf8");
  const otpRoute = readFileSync(new URL("../src/app/api/bookings/otp/route.ts", import.meta.url), "utf8");
  assert.match(finder, /onOpenManage\(reference, action, sessionId\)/);
  assert.match(finder, /openBooking\(booking\.reference, "reschedule", booking\.id\)/);
  assert.match(finder, /booking\.status === "pending_payment"/);
  assert.match(finder, /booking\.paymentStatus === "due" && isUpcoming/);
  assert.doesNotMatch(finder, /Package purchases/);
  assert.match(finder, /Welcome back\{studentName \?/);
  assert.match(finder, /email\.trim\(\)/);
  assert.match(finder, /Reference: \{booking\.reference\}/);
  assert.match(finder, /orderBookingsForOverview\(bookings/);
  assert.match(finder, /Paid.*Awaiting payment/);
  assert.doesNotMatch(finder, /window\.location\.assign\(`\/booking\/manage/);
  assert.doesNotMatch(finder, /href="\/lessons"/);
  assert.match(otpRoute, /paymentStatus: booking\.paymentStatus/);
  assert.match(manage, /Add a lesson/);
  assert.match(manage, /StripePackagePurchaseButton/);
  assert.match(manage, /<LessonStep/);
  assert.match(manage, /Choose the add-on lesson package you want/);
  assert.match(manage, /Select a date and time for every lesson/);
  assert.ok(manage.indexOf(">Reschedule (") < manage.indexOf("Add a lesson"));
  assert.match(manage, /<DateTimeStep/);
  assert.match(manage, /withinCancellationWindow/);
  assert.match(manage, /Confirming uses your one online reschedule/);
  assert.match(manage, /await returnToBookings\(\)/);
  assert.match(manage, /initialAction === "reschedule" && selectedSessionCanReschedule/);
  assert.doesNotMatch(manage, /showAddOns|Add an add-on lesson/);
  assert.match(manage, /mode === "addons" && booking\.paymentStatus === "paid"/);
  assert.match(manage, /addMonthsToKey\(todayKey\(\), 6\)/);
  assert.match(manage, /horizonDays=\{370\}/);
  assert.match(dateTime, /selectedSlot && visibleSlots\.includes\(selectedSlot\)/);
  assert.doesNotMatch(dateTime, /!minDate \|\| key >= minDate/);
  assert.match(packageCheckout, /onAvailabilityConflict\?\.\(\)/);
  assert.match(manage, /onAvailabilityConflict=\{\(\) => setAvailabilityRevision/);
  assert.match(manage, /await returnToBookings\(\)/);
  assert.match(manage, /buttonLabel="Next"/);
  assert.match(manage, /Back<\/Button>/);
  assert.doesNotMatch(manage, /Back to all bookings|Keep current time|Confirm new time/);
  assert.match(manage, /addOnStep === "schedule"\) setAddOnStep\("select"\)/);
  assert.match(manage, /setShowExitConfirmation\(true\)/);
});

test("each scheduled lesson has exactly one student reschedule", () => {
  assert.equal(MAX_STUDENT_RESCHEDULES_PER_SESSION, 1);
  const migration = readFileSync(new URL("../supabase/migrations/0039_mybooking_addon_eligibility_and_reschedule_limit.sql", import.meta.url), "utf8");
  const manage = readFileSync(new URL("../src/components/booking/booking-manage.tsx", import.meta.url), "utf8");
  const fileStore = readFileSync(new URL("../src/lib/booking/file-store.ts", import.meta.url), "utf8");
  assert.match(migration, /v_target\.student_reschedule_count >= 1/);
  assert.match(migration, /v_booking\.student_reschedule_count >= 1/);
  assert.doesNotMatch(migration, /student_reschedule_count >= 2/);
  assert.match(manage, /session\.studentRescheduleCount >= MAX_STUDENT_RESCHEDULES_PER_SESSION/);
  assert.match(manage, /1 reschedule available/);
  assert.match(fileStore, /studentRescheduleCount \?\? 0\) >= MAX_STUDENT_RESCHEDULES_PER_SESSION/);
});

test("paid single lessons can use their one online reschedule", () => {
  const migration = readFileSync(new URL("../supabase/migrations/0040_allow_paid_single_booking_reschedule.sql", import.meta.url), "utf8");
  const manageRoute = readFileSync(new URL("../src/app/api/bookings/manage/route.ts", import.meta.url), "utf8");
  const fileStore = readFileSync(new URL("../src/lib/booking/file-store.ts", import.meta.url), "utf8");
  assert.match(migration, /student_reschedule_count >= 1/);
  assert.match(migration, /starts_at < now\(\) \+ interval '48 hours'/);
  assert.doesNotMatch(migration, /session_count = 1 and exists[\s\S]{0,180}payment_status = 'paid'/);
  assert.match(manageRoute, /const paidBooking = targetBooking\.paymentStatus === "paid"/);
  assert.match(manageRoute, /if \(!paidBooking && paymentBooking\.stripeCheckoutSessionId\)/);
  assert.doesNotMatch(manageRoute, /This booking has already been paid\. Contact the school before rescheduling\./);
  assert.doesNotMatch(fileStore, /sessionCount \?\? 1\) === 1 && target\.paymentStatus === "paid"/);
});

test("add-on package checkout requires a bounded list of valid selected times", () => {
  const startsAt = ["2026-12-01T17:00:00.000Z", "2026-12-08T17:00:00.000Z"];
  const packageItem = { lessonId: "two-lesson-package", quantity: 1, startsAt };
  assert.equal(packagePurchaseSchema.safeParse({ packages: [packageItem] }).success, true);
  assert.equal(packagePurchaseSchema.safeParse({ packages: [{ ...packageItem, startsAt: undefined }] }).success, false);
  assert.equal(packagePurchaseSchema.safeParse({ packages: [{ ...packageItem, startsAt: ["not-a-date"] }] }).success, false);
  assert.equal(packagePurchaseSchema.safeParse({ packages: [{ ...packageItem, quantity: 0 }] }).success, false);
  assert.equal(packagePurchaseSchema.safeParse({ packages: [{ ...packageItem, quantity: 21 }] }).success, false);
  assert.equal(packagePurchaseSchema.safeParse({ packages: [{ ...packageItem, quantity: 1.5 }] }).success, false);
  assert.equal(packagePurchaseSchema.safeParse({ packages: [packageItem, { ...packageItem, lessonId: "45-minute-package" }] }).success, true);
  assert.equal(packagePurchaseSchema.safeParse({ packages: [packageItem, packageItem] }).success, false);
  const bundleMigration = readFileSync(new URL("../supabase/migrations/0047_multi_package_addon_checkout.sql", import.meta.url), "utf8");
  assert.match(bundleMigration, /create_scheduled_package_purchase_bundle/);
  assert.match(bundleMigration, /stripe_checkout_session_id = p_session_id/);
});

test("OTP reference validation accepts add-on package references", () => {
  assert.equal(otpSchema.safeParse({ action: "token", email: "student@example.com", code: "123456", reference: "WDA-A-1234567890AB" }).success, true);
});

test("My Booking lets users add packages only after selecting all lesson times and has no upgrade controls", () => {
  const manage = readFileSync(new URL("../src/components/booking/booking-manage.tsx", import.meta.url), "utf8");
  const purchaseButton = readFileSync(new URL("../src/components/booking/stripe-package-purchase-button.tsx", import.meta.url), "utf8");
  assert.match(manage, /Select a date and time for each of the/);
  assert.match(manage, /packages=\{scheduledAddOnPackages\}/);
  assert.doesNotMatch(manage, /Upgrade package|StripeUpgradeButton|upgradeOptions/);
  assert.match(manage, /onBackToBookings\(\)/);
  assert.match(manage, /Back<\/Button>/);
  assert.doesNotMatch(manage, /showAddOns|Add an add-on lesson/);
  assert.match(manage, /role="dialog" aria-modal="true"/);
  assert.match(manage, /Return to lesson history/);
  assert.match(manage, /Stay in add-on flow/);
  assert.doesNotMatch(manage, /Back to My Booking lookup/);
  assert.match(manage, /Your booking and add-on lessons/);
  assert.match(manage, /Reschedule lesson/);
  assert.match(manage, /if \(!event\.persisted\) void clearSession\(\)/);
  assert.doesNotMatch(manage, /popstate|reloadRestoredPage/);
  assert.match(manage, /clearOnLeavingLink/);
  assert.match(purchaseButton, /startsAt/);
  const purchaseRoute = readFileSync(new URL("../src/app/api/stripe/package-purchase/route.ts", import.meta.url), "utf8");
  assert.match(purchaseRoute, /selection\.startsAt\.length !== credits/);
  assert.match(purchaseRoute, /session\.paymentStatus === "paid"/);
  assert.match(purchaseRoute, /getPackagePurchaseByToken\(tokenHash\)/);
  assert.match(purchaseRoute, /createScheduledPackagePurchaseBundle/);
  assert.match(purchaseRoute, /availability_conflict/);
  assert.match(purchaseRoute, /reservation_conflict/);
  assert.match(purchaseButton, /result\.failure/);
  assert.match(purchaseRoute, /line_items: purchaseItems\.map/);
  assert.doesNotMatch(purchaseRoute, /Date\.parse\(session\.startsAt\).*48/);
  const store = readFileSync(new URL("../src/lib/booking/supabase-store.ts", import.meta.url), "utf8");
  assert.match(store, /p_quantity: packageQuantity/);
  assert.doesNotMatch(store, /p_quantity: input\.creditsPurchased/);
  const fileStore = readFileSync(new URL("../src/lib/booking/file-store.ts", import.meta.url), "utf8");
  assert.match(fileStore, /lesson\.sessionCount \* packageQuantity !== input\.creditsPurchased/);
  assert.match(purchaseRoute, /We couldn’t reserve those lesson times/);
  const reservationMigration = readFileSync(new URL("../supabase/migrations/0054_preserve_addon_reservation_errors.sql", import.meta.url), "utf8");
  assert.match(reservationMigration, /v_child_error := v_result->>'error'/);
  assert.match(reservationMigration, /'conflict', 'not_found', 'not_modifiable'/);
  const manageRoute = readFileSync(new URL("../src/app/api/bookings/manage/route.ts", import.meta.url), "utf8");
  assert.match(manageRoute, /const canAddPackage = activePaidSessions\.length > 0/);
  assert.match(manageRoute, /addOnOptions/);
  assert.match(manageRoute, /activePaidSessions\[0\]/);
  assert.match(manageRoute, /function loadManageContext/);
  assert.match(manageRoute, /Added from My Booking/);
  const linkedSessionMigration = readFileSync(new URL("../supabase/migrations/0057_reschedule_related_mybooking_sessions.sql", import.meta.url), "utf8");
  assert.match(linkedSessionMigration, /v_target_root_reference <> v_anchor_root_reference/);
  assert.match(linkedSessionMigration, /package_purchase_tokens/);
  assert.match(linkedSessionMigration, /booking_start_cadence_min/);
  const finder = readFileSync(new URL("../src/components/booking/booking-find.tsx", import.meta.url), "utf8");
  assert.match(finder, /We verified this email, but couldn’t find any scheduled lessons linked to it/);
  assert.match(finder, /Back to verification/);
  assert.match(finder, /onOpenManage\(reference, action, sessionId\)/);
  assert.doesNotMatch(finder, /window\.location\.assign\(`\/booking\/manage/);
  assert.doesNotMatch(finder, /Back to home/);
  assert.doesNotMatch(manage, /Back to home/);
  const portal = readFileSync(new URL("../src/components/booking/booking-portal.tsx", import.meta.url), "utf8");
  assert.match(portal, /<BookingFind[\s\S]*onOpenManage=\{openManage\}/);
  assert.match(portal, /<BookingManage/);
});

test("add-on Stripe returns preserve the manage session and reopen selections after cancellation", () => {
  const portal = readFileSync(new URL("../src/components/booking/booking-portal.tsx", import.meta.url), "utf8");
  const finder = readFileSync(new URL("../src/components/booking/booking-find.tsx", import.meta.url), "utf8");
  const manage = readFileSync(new URL("../src/components/booking/booking-manage.tsx", import.meta.url), "utf8");
  const button = readFileSync(new URL("../src/components/booking/stripe-package-purchase-button.tsx", import.meta.url), "utf8");
  const session = readFileSync(new URL("../src/lib/booking/manage-session-client.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../src/app/api/stripe/package-purchase/route.ts", import.meta.url), "utf8");
  const manageRoute = readFileSync(new URL("../src/app/api/bookings/manage/route.ts", import.meta.url), "utf8");
  assert.match(manageRoute, /if \(action === "history"\)/);
  assert.match(manageRoute, /store\.findBookingsByEmail\(email\)/);
  assert.match(portal, /JSON\.stringify\(\{ action: "history" \}\)/);
  assert.match(portal, /setForceVerifiedHistory\(true\)/);
  assert.match(portal, /forceVerifiedHistory=\{forceVerifiedHistory\}/);
  assert.match(finder, /forceVerifiedHistory && \(bookings\.length > 0 \|\| purchases\.length > 0\) \? "list" : step/);
  assert.match(finder, /onDismissForcedHistory\?\.\(\)/);
  assert.match(portal, /const backToBookings = useCallback\(async \(\) => \{\s*\/\/ This is an in-session return to the already-verified lesson history,[\s\S]*?setShowManage\(false\);\s*setActiveReference\(""\);\s*setActiveAction\("details"\);\s*setActiveSessionId\(undefined\);/);
  assert.doesNotMatch(portal.match(/const backToBookings = useCallback\([\s\S]*?\}, \[\]\);/)?.[0] ?? "", /fetch\("\/api\/bookings\/session"/);
  assert.match(portal, /packagePurchaseAdded && paymentReturn === "cancelled" \? "addons" : "details"/);
  assert.match(portal, /hasManageCookie && !successfulAddonReturn/);
  assert.match(portal, /Require the same email \+ OTP verification/);
  assert.match(portal, /verify the code to view your updated My Booking lessons/);
  assert.match(manage, /consumeManageAddonSelection\(\)/);
  assert.match(manage, /clearManageAddonSelection\(\)/);
  assert.match(button, /saveManageAddonSelection\(packages\)/);
  assert.match(session, /sessionStorage\.setItem\(ADDON_SELECTION_MARKER/);
  assert.match(route, /payment=success&purchase=added/);
  assert.match(route, /payment=cancelled&purchase=added/);
  assert.match(manage, /aria-labelledby="exit-booking-title"/);
  assert.match(manage, /buttonLabel="Next"/);
});

test("90-minute lessons and 45-minute road tests reserve 120-minute instructor blocks", () => {
  assert.equal(occupiedDurationMin(90), 120);
  assert.equal(occupiedDurationMin(45), 120);
  assert.equal(occupiedDurationMin(120), 120);

  const bookedStart = zonedToUtc(2026, 11, 3, 8 * 60);
  const bookedOccupiedEnd = new Date(bookedStart.getTime() + occupiedDurationMin(90) * 60_000);
  const slots = generateSlots({
    lessonDurationMin: 90,
    fromDayKey: "2026-11-03",
    toDayKey: "2026-11-03",
    busy: [{ startsAt: bookedStart.toISOString(), endsAt: bookedOccupiedEnd.toISOString() }],
    blackouts: [],
    rules: [{ weekday: 2, startMin: 8 * 60, endMin: 18 * 60 }],
    now: new Date("2026-11-01T20:00:00.000Z"),
  });

  assert.equal(slots.includes(bookedStart.toISOString()), false);
  assert.equal(slots.includes(zonedToUtc(2026, 11, 3, 9 * 60).toISOString()), false);
  assert.equal(slots.includes(zonedToUtc(2026, 11, 3, 9 * 60 + 30).toISOString()), false);
  assert.equal(slots.includes(bookedOccupiedEnd.toISOString()), true);
  assert.equal(slots.includes(zonedToUtc(2026, 11, 3, 10 * 60).toISOString()), true);
  assert.equal(slots.includes(zonedToUtc(2026, 11, 3, 10 * 60 + 30).toISOString()), false);
  assert.equal(slots.includes(zonedToUtc(2026, 11, 3, 16 * 60).toISOString()), true);
  assert.equal(slots.includes(zonedToUtc(2026, 11, 3, 16 * 60 + 30).toISOString()), false);
});

test("45-minute road-test appointments reserve 120 minutes and use two-hour start spacing", () => {
  const slots = generateSlots({
    lessonDurationMin: 45,
    fromDayKey: "2026-11-03",
    toDayKey: "2026-11-03",
    busy: [],
    blackouts: [],
    rules: [{ weekday: 2, startMin: 7 * 60, endMin: 19 * 60 }],
    now: new Date("2026-11-01T20:00:00.000Z"),
  });
  assert.deepEqual([7, 9, 11, 13, 15, 17].map((hour) => {
    const minutes = Math.round(hour * 60);
    return zonedToUtc(2026, 11, 3, minutes).toISOString();
  }), slots);
});

test("90-minute lesson starts follow a two-hour cadence anchored to daily availability", () => {
  const slots = generateSlots({
    lessonDurationMin: 90,
    fromDayKey: "2026-11-03",
    toDayKey: "2026-11-03",
    busy: [],
    blackouts: [],
    rules: [{ weekday: 2, startMin: 8 * 60, endMin: 18 * 60 }],
    now: new Date("2026-11-01T20:00:00.000Z"),
  });
  assert.deepEqual(slots, [8, 10, 12, 14, 16].map((hour) => zonedToUtc(2026, 11, 3, hour * 60).toISOString()));
  const afternoon = generateSlots({
    lessonDurationMin: 90,
    fromDayKey: "2026-11-03",
    toDayKey: "2026-11-03",
    busy: [],
    blackouts: [],
    rules: [{ weekday: 2, startMin: 13 * 60, endMin: 19 * 60 }],
    now: new Date("2026-11-01T20:00:00.000Z"),
  });
  assert.deepEqual(afternoon, [13, 15, 17].map((hour) => zonedToUtc(2026, 11, 3, hour * 60).toISOString()));
});

test("date-specific availability overrides replace that date's weekly window", () => {
  const slots = generateSlots({
    lessonDurationMin: 90,
    fromDayKey: "2026-11-03",
    toDayKey: "2026-11-03",
    busy: [],
    blackouts: [],
    rules: [{ weekday: 2, startMin: 7 * 60, endMin: 19 * 60 }],
    dateOverrides: [{ date: "2026-11-03", startMin: 7 * 60, endMin: 15 * 60 }],
    now: new Date("2026-11-01T20:00:00.000Z"),
  });
  assert.deepEqual(slots, [7, 9, 11, 13].map((hour) => zonedToUtc(2026, 11, 3, hour * 60).toISOString()));
});

test("database booking guards accept the same date-specific windows and cadence as availability", () => {
  const migration = readFileSync(new URL("../supabase/migrations/0052_booking_triggers_honor_date_overrides.sql", import.meta.url), "utf8");
  assert.match(migration, /select \* into v_override from public\.availability_date_overrides/);
  assert.match(migration, /v_start_min := v_override\.start_min/);
  assert.match(migration, /v_start_min := v_rule\.start_min/);
  assert.match(migration, /mod\(v_minute - v_start_min, public\.booking_start_cadence_min/);
  assert.doesNotMatch(migration, /not found or v_minute < v_rule\.start_min/);
});

test("add-on SQL accepts the full six-month local calendar day shown by the picker", () => {
  const migration = readFileSync(new URL("../supabase/migrations/0053_addon_six_month_date_limit.sql", import.meta.url), "utf8");
  assert.ok(migration.includes("(v_first at time zone ''America/Vancouver'')::date > ((v_now at time zone ''America/Vancouver'')::date + interval ''6 months'')::date"));
  assert.match(migration, /v_old_limit/);
});

test("add-on checkout allows a date override when no weekly availability row exists", () => {
  const migration = readFileSync(new URL("../supabase/migrations/0055_addon_overrides_without_weekly_rule.sql", import.meta.url), "utf8");
  assert.ok(migration.indexOf("select * into v_override") < migration.indexOf("if v_rule.weekday is null"));
  assert.match(migration, /if found then[\s\S]*v_start_min := v_override\.start_min/);
  assert.match(migration, /else[\s\S]*if v_rule\.weekday is null then/);
});

test("My Booking add-on checkout reports database schedule rejection details", () => {
  const migration = readFileSync(new URL("../supabase/migrations/0056_identify_addon_schedule_rejection.sql", import.meta.url), "utf8");
  const route = readFileSync(new URL("../src/app/api/stripe/package-purchase/route.ts", import.meta.url), "utf8");
  assert.match(migration, /interval '135 minutes'/);
  assert.match(migration, /'failure', 'lead_time'/);
  assert.match(migration, /'failure', 'schedule_rule'/);
  assert.match(migration, /v_child_failure := v_result->>'failure'/);
  assert.match(route, /created\.failure === "schedule_rule"/);
  assert.match(route, /ADDON_CHECKOUT_LEAD_TIME_MIN = 135/);
});

test("My Booking generates add-on references in the format required by the database", () => {
  const route = readFileSync(new URL("../src/app/api/stripe/package-purchase/route.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/0039_mybooking_addon_eligibility_and_reschedule_limit.sql", import.meta.url), "utf8");
  assert.match(route, /reference: `WDA-A-\$\{Array\.from\(randomBytes\(12\)/);
  assert.match(migration, /p_reference !~ '\^WDA-A-\[A-Z0-9\]\{12\}\$'/);
});

test("Pacific booking times remain UTC-7 after British Columbia's final clock change", () => {
  const nineAm = zonedToUtc(2027, 1, 2, 9 * 60);
  assert.equal(nineAm.toISOString(), "2027-01-02T16:00:00.000Z");
  assert.equal(toVancouverParts(nineAm).minutesOfDay, 9 * 60);
  assert.equal(toVancouverDayKey(new Date("2027-01-02T06:59:00.000Z")), "2027-01-01");
  assert.equal(toVancouverDayKey(new Date("2027-01-02T07:00:00.000Z")), "2027-01-02");
  assert.equal(dayKeyOf("2027-01-02T16:00:00.000Z"), "2027-01-02");
  assert.match(formatSlotTime("2027-01-02T16:00:00.000Z"), /9/);
});

test("booking validation accepts quantity-based package selection", () => {
  const parsed = createBookingSchema.safeParse({
    lessonId: "90-minute-lesson",
    packageSchedules: [
      { lessonId: "90-minute-lesson", quantity: 1, startsAt: ["2026-11-03T16:00:00.000Z"] },
      { lessonId: "eight-lesson-pack", quantity: 15, startsAt: Array.from({ length: 120 }, (_, index) => new Date(Date.UTC(2026, 10, 4 + index, 16)).toISOString()) },
    ],
    addOnPackages: [{ lessonId: "eight-lesson-pack", quantity: 15 }],
    studentName: "Example Student",
    email: "student@example.com",
    phone: "6045550100",
    dateOfBirth: "1990-01-01",
    gender: "prefer_not_to_say",
    licenseNumber: "BC123456",
    holdToken: "h".repeat(43),
    consent: true,
  });
  assert.equal(parsed.success, true);
  assert.equal(createBookingSchema.safeParse({
    lessonId: "90-minute-lesson",
    startsAt: "2026-11-03T16:00:00.000Z",
    addOnPackages: [{ lessonId: "eight-lesson-pack", quantity: 1 }],
    studentName: "Example Student",
    email: "student@example.com",
    phone: "6045550100",
    dateOfBirth: "1990-01-01",
    gender: "woman",
    licenseNumber: "BC123456",
    holdToken: "h".repeat(43),
    consent: true,
  }).success, false);
  assert.equal(createBookingSchema.safeParse({
    lessonId: "90-minute-lesson",
    startsAt: "2026-11-03T16:00:00.000Z",
    studentName: "Example Student",
    email: "student@example.com",
    phone: "6045550100",
    dateOfBirth: "2999-01-01",
    gender: "woman",
    licenseNumber: "BC123456",
    holdToken: "h".repeat(43),
    consent: true,
  }).success, false);
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

test("live Checkout is fail-closed unless explicitly enabled with live credentials and a webhook secret", () => {
  const liveConfig = {
    nodeEnv: "production",
    secretKey: "sk_live_1234567890",
    livePaymentsEnabled: "true",
    webhookSecret: "whsec_1234567890",
  };
  assert.equal(isStripePaymentsEnabled(liveConfig), true);
  assert.equal(isStripePaymentsEnabled({ ...liveConfig, livePaymentsEnabled: "false" }), false);
  assert.equal(isStripePaymentsEnabled({ ...liveConfig, livePaymentsEnabled: undefined }), false);
  assert.equal(isStripePaymentsEnabled({ ...liveConfig, secretKey: "sk_test_1234567890" }), true);
  assert.equal(isStripePaymentsEnabled({ ...liveConfig, secretKey: "sk_live_bad-value" }), false);
  assert.equal(isStripePaymentsEnabled({ ...liveConfig, webhookSecret: undefined }), false);
  assert.equal(isStripePaymentsEnabled({ ...liveConfig, webhookSecret: "whsec_" }), false);
  assert.equal(isStripePaymentsEnabled({ ...liveConfig, nodeEnv: "development" }), false);
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
  assert.equal(matchesInitialBookingPayment(session, booking, 20), false);
  assert.equal(matchesInitialBookingPayment({ ...session, amount_subtotal: 14000, amount_total: 15400, total_details: { amount_tax: 1400 } }, booking, 20), true);
  assert.equal(matchesInitialBookingPayment({ ...session, id: "cs_other" }, booking), false);
  assert.equal(matchesInitialBookingPayment({ ...session, amount_subtotal: 1 }, booking), false);
  assert.equal(matchesInitialBookingPayment({ ...session, currency: "usd" }, booking), false);
  assert.equal(matchesInitialBookingPayment({ ...session, client_reference_id: "WDA-OTHER" }, booking), false);
  assert.equal(matchesInitialBookingPayment({ ...session, amount_total: 13199 }, booking), false);
  assert.equal(matchesInitialBookingPayment(session, { ...booking, stripeCheckoutSessionId: undefined }), false);
  const packageBooking = { ...booking, priceCad: 90, packagePriceCad: 720 };
  assert.equal(matchesInitialBookingPayment({ ...session, amount_subtotal: 72000, amount_total: 79200, total_details: { amount_tax: 7200 } }, packageBooking), true);
  assert.equal(matchesInitialBookingPayment({ ...session, amount_subtotal: 9000, amount_total: 9900, total_details: { amount_tax: 900 } }, packageBooking), false);
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

test("paid independent package purchases must match the saved order and CAD totals", () => {
  const purchase = { id: "purchase-123", reference: "WDA-P-123456", amountCad: 720, stripeCheckoutSessionId: "cs_purchase_123" };
  const session = {
    id: "cs_purchase_123",
    mode: "payment",
    currency: "cad",
    client_reference_id: purchase.reference,
    metadata: { checkout_kind: "package_purchase", purchase_id: purchase.id, purchase_reference: purchase.reference },
    amount_subtotal: 72000,
    amount_total: 79200,
    total_details: { amount_tax: 7200 },
  };
  assert.equal(matchesPackagePurchasePayment(session, purchase), true);
  assert.equal(matchesPackagePurchasePayment({ ...session, id: "cs_other" }, purchase), false);
  assert.equal(matchesPackagePurchasePayment({ ...session, currency: "usd" }, purchase), false);
  assert.equal(matchesPackagePurchasePayment({ ...session, amount_subtotal: 45000 }, purchase), false);
  assert.equal(matchesPackagePurchasePayment({ ...session, amount_total: 79199 }, purchase), false);
  assert.equal(matchesPackagePurchasePayment({ ...session, metadata: { ...session.metadata, purchase_id: "other" } }, purchase), false);
});

test("safe error logging never emits provider error messages", () => {
  const original = console.error;
  let logged;
  console.error = (...args) => { logged = args; };
  try {
    logSafeError("test", { name: "ApiError", code: "safe_code", type: "StripeInvalidRequestError", statusCode: 400, message: "sensitive customer detail" });
  } finally {
    console.error = original;
  }
  assert.deepEqual(logged, ["test", { name: "ApiError", code: "safe_code", type: "StripeInvalidRequestError", statusCode: 400 }]);
});

test("booking holds are consistently twenty minutes across API, UI and database", () => {
  const route = readFileSync(new URL("../src/app/api/bookings/hold/route.ts", import.meta.url), "utf8");
  const wizard = readFileSync(new URL("../src/components/booking/booking-wizard.tsx", import.meta.url), "utf8");
  const fileStore = readFileSync(new URL("../src/lib/booking/file-store.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/0042_extend_booking_holds_to_twenty_minutes.sql", import.meta.url), "utf8");
  assert.match(route, /HOLD_MS = 20 \* 60_000/);
  assert.match(wizard, /Pacific \(20 minutes\)/);
  assert.doesNotMatch(wizard, /\(8 minutes\)|held for 10 minutes|held for 8 minutes/);
  assert.match(migration, /20 minutes 15 seconds/);
  assert.match(migration, /created_at\+interval '20 minutes'/);
  assert.match(fileStore, /BOOKING_HOLD_MS = 20 \* 60_000/);
  assert.doesNotMatch(fileStore, /createdAt\) \+ 10 \* 60/);
});

test("admin student records require explicit booking links and protect licence search", () => {
  const migration = readFileSync(new URL("../supabase/migrations/0041_secure_student_profiles_and_progress.sql", import.meta.url), "utf8");
  const search = readFileSync(new URL("../src/app/admin/(panel)/calendar/actions.ts", import.meta.url), "utf8");
  const csv = readFileSync(new URL("../src/app/admin/(panel)/students/[bookingId]/csv/route.ts", import.meta.url), "utf8");
  assert.match(migration, /group by coalesce\(b\.package_id, b\.id\)/);
  assert.doesNotMatch(migration, /group by lower\(b\.email\)/);
  assert.match(migration, /regexp_replace\(upper\(s\.license_number\)/);
  assert.match(migration, /booking_student_details d join public\.student_profile_bookings/);
  assert.match(migration, /returns table\(booking_id uuid\)/);
  assert.match(search, /await requireAdmin\("\/admin\/calendar"\)/);
  assert.match(search, /redirect\(`\/admin\/students/);
  assert.doesNotMatch(search, /redirect\([^\n]*license\.data/);
  assert.match(csv, /await requireAdmin\("\/admin\/students"\)/);
  assert.match(csv, /Cache-Control.*private, no-store/);
  assert.match(migration, /student_profile_audit/);
  assert.match(migration, /student_assessments/);
});

test("overall student report unlocks only after every booked lesson is complete or cancelled", () => {
  const lesson = (status) => ({ status });
  assert.equal(studentSessionsComplete([]), false);
  assert.equal(studentSessionsComplete([lesson("completed")]), true);
  assert.equal(studentSessionsComplete([lesson("completed"), lesson("cancelled")]), true);
  assert.equal(studentSessionsComplete([lesson("completed"), lesson("confirmed")]), false);
  assert.equal(studentSessionsComplete([lesson("completed"), lesson("no_show")]), false);
  assert.equal(studentSessionsComplete([lesson("cancelled")]), false);
});

test("payment actions return failures to Payments and keep cheque changes functional", () => {
  const actions = readFileSync(new URL("../src/app/admin/(panel)/bookings/actions.ts", import.meta.url), "utf8");
  const page = readFileSync(new URL("../src/app/admin/(panel)/payments/page.tsx", import.meta.url), "utf8");
  assert.match(actions, /paymentFail = \(message: string\): never => redirect\(`\$\{safeReturnTo\}\?error=/);
  assert.match(actions, /expireOpenCheckout\(checkoutOwner, safeReturnTo\)/);
  assert.match(actions, /parsed\.data\.status === "received" \|\| parsed\.data\.status === "cleared"/);
  assert.doesNotMatch(actions, /if \(\(status === "received" \|\| status === "cleared"\)/);
  assert.match(page, /RecordCashButton bookingId=\{booking\.id\}/);
  assert.match(page, /Cheque tracking/);
  assert.match(page, /params\.error/);
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
  const bookingValidation = readFileSync(new URL("../src/lib/validation/booking.ts", import.meta.url), "utf8");
  const detailsStep = readFileSync(new URL("../src/components/booking/details-step.tsx", import.meta.url), "utf8");
  assert.match(bookingValidation, /gender: z\.enum\(\["woman", "man", "prefer_not_to_say"\]\)/);
  assert.doesNotMatch(detailsStep, /non_binary|another_identity|Non-binary|Another gender identity/);
});

test("admin student PDF contains session details and safely escapes PDF text", () => {
  const pdf = createStudentBookingPdf([{
    id: "e3b2a1f0-1234-4234-9234-123456789abc",
    reference: "WDA-ABC123",
    lessonId: "five-lesson-pack",
    lessonName: "Driver (Training)",
    durationMin: 90,
    priceCad: 450,
    startsAt: "2026-11-05T18:00:00.000Z",
    endsAt: "2026-11-05T19:30:00.000Z",
    studentName: "Alex Example",
    email: "alex@example.com",
    phone: "555-0100",
    notes: "Pickup address: 123 Main St, Vancouver, BC\nLicence class: 7L",
    status: "confirmed",
    paymentStatus: "paid",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
  }], new Date("2026-11-01T12:00:00.000Z"), {
    dateOfBirth: "1990-01-01",
    gender: "prefer_not_to_say",
    licenseNumber: "BC123456",
  });
  const text = Buffer.from(pdf).toString("ascii");
  assert.equal(text.startsWith("%PDF-1.4"), true);
  assert.match(text, /Alex Example/);
  assert.match(text, /alex@example\.com/);
  assert.match(text, /123 Main St, Vancouver, BC/);
  assert.equal(text.includes("Driver \\(Training\\)"), true);
  assert.match(text, /CONFIDENTIAL - for authorized school administration only/);
  assert.match(text, /Date of birth/i);
  assert.match(text, /1990-01-01/);
  assert.match(text, /Driver's licence/i);
  assert.match(text, /BC123456/);
  assert.match(text, /\/Subtype \/Image/);
  assert.doesNotMatch(text, /Licence class: 7L/);
});

test("verified customers can view completed booking history but cannot modify it", () => {
  assert.equal(customerCanAccessBooking("confirmed"), true);
  assert.equal(customerCanAccessBooking("rescheduled"), true);
  assert.equal(customerCanAccessBooking("pending_payment"), true);
  assert.equal(customerCanAccessBooking("cancelled"), true);
  assert.equal(customerCanAccessBooking("completed"), true);
  assert.equal(customerCanAccessBooking("no_show"), true);
  const manageApi = readFileSync(new URL("../src/app/api/bookings/manage/route.ts", import.meta.url), "utf8");
  const manageUi = readFileSync(new URL("../src/components/booking/booking-manage.tsx", import.meta.url), "utf8");
  assert.match(manageApi, /Date\.parse\(targetBooking\.startsAt\) <= Date\.now\(\)/);
  assert.match(manageUi, /This lesson has expired\. Please contact your tutor for help\./);
});

test("unconfirmed booking requests do not trigger email; payment events have confirmation mail handlers", () => {
  const bookingRoute = readFileSync(new URL("../src/app/api/bookings/route.ts", import.meta.url), "utf8");
  const fulfillment = readFileSync(new URL("../src/lib/stripe/fulfill.ts", import.meta.url), "utf8");
  assert.doesNotMatch(bookingRoute, /sendBookingPaymentPendingEmail/);
  assert.match(fulfillment, /sendBookingPaymentReceivedEmail/);
  assert.match(fulfillment, /sendPackagePurchasePaidEmail/);
});

test("package scheduling uses calendar-month windows and package fields are validated", () => {
  assert.equal(HORIZON_DAYS, 370);
  assert.equal(addMonthsToKey("2026-01-31", 6), "2026-07-31");
  assert.equal(addMonthsToKey("2026-12-31", 6), "2027-06-30");
  const details = {
    lessonId: "eight-lesson-pack",
    studentName: "Alex Example",
    email: "alex@example.com",
    phone: "555-0100",
    dateOfBirth: "1990-01-01",
    gender: "woman",
    licenseNumber: "BC123456",
    holdToken: "h".repeat(43),
    consent: true,
  };
  assert.equal(createBookingSchema.safeParse({ ...details, sessions: Array.from({ length: 8 }, (_, i) => `2026-11-${String(i + 2).padStart(2, "0")}T18:00:00.000Z`) }).success, true);
  assert.equal(createBookingSchema.safeParse({ ...details, startsAt: "2026-11-02T18:00:00.000Z", sessions: ["2026-11-03T18:00:00.000Z"] }).success, false);
  assert.equal(createBookingSchema.safeParse(details).success, false);
});

test("tutor reports gate lesson completion and course closure preserves unused sessions", () => {
  const migration = readFileSync(new URL("../supabase/migrations/0043_tutor_reports_and_course_completion.sql", import.meta.url), "utf8");
  const calendar = readFileSync(new URL("../src/app/admin/(panel)/calendar/day-bookings-accordion.tsx", import.meta.url), "utf8");
  const bookings = readFileSync(new URL("../src/app/admin/(panel)/bookings/page.tsx", import.meta.url), "utf8");
  const students = readFileSync(new URL("../src/app/admin/(panel)/students/[bookingId]/page.tsx", import.meta.url), "utf8");
  assert.match(calendar, /saveTutorLessonReportAction/);
  assert.match(migration, /where l\.booking_id=p_booking_id/);
  assert.match(migration, /'report_required'/);
  assert.match(migration, /v_completed<v_expected/);
  assert.match(migration, /ended_early/);
  assert.match(students, /completedCount} of \{expectedCount} lessons completed/);
  assert.match(students, /course\.averages/);
  assert.match(bookings, /Open in Calendar/);
  assert.doesNotMatch(bookings, /BookingActions/);
  assert.doesNotMatch(students, /BookingActions/);
  assert.match(migration, /where coalesce\(package_id,id\)=v_package_id and status not in \('cancelled','completed'\)/);
});

test("tutor lesson reports use the requested detailed 1–10 rubric and retain category comments in exports", () => {
  const migration = readFileSync(new URL("../supabase/migrations/0048_detailed_tutor_report_rubric.sql", import.meta.url), "utf8");
  const calendar = readFileSync(new URL("../src/app/admin/(panel)/calendar/day-bookings-accordion.tsx", import.meta.url), "utf8");
  const scheduleGrid = readFileSync(new URL("../src/app/admin/(panel)/calendar/schedule-grid.tsx", import.meta.url), "utf8");
  const action = readFileSync(new URL("../src/app/admin/(panel)/calendar/actions.ts", import.meta.url), "utf8");
  const studentPage = readFileSync(new URL("../src/app/admin/(panel)/students/[bookingId]/page.tsx", import.meta.url), "utf8");
  const csv = readFileSync(new URL("../src/app/admin/(panel)/students/[bookingId]/csv/route.ts", import.meta.url), "utf8");
  const pdf = readFileSync(new URL("../src/app/admin/(panel)/students/[bookingId]/pdf/route.ts", import.meta.url), "utf8");
  const calendarPage = readFileSync(new URL("../src/app/admin/(panel)/calendar/page.tsx", import.meta.url), "utf8");
  assert.equal(TUTOR_REPORT_RUBRIC.length, 9);
  assert.equal(TUTOR_REPORT_ITEMS.length, 32);
  assert.equal(TUTOR_REPORT_RUBRIC[0].title, "Observation");
  assert.equal(TUTOR_REPORT_RUBRIC.at(-1).title, "Choosing the Appropriate Pedal");
  assert.match(calendar, /Rate the skills practiced today from 1–10/);
  assert.match(calendar, /score_\$\{item\.key\}/);
  assert.match(calendar, /comment_\$\{section\.key\}/);
  assert.match(scheduleGrid, /block overflow-x-auto/);
  assert.match(scheduleGrid, /pointer-events-auto relative border-t/);
  assert.match(scheduleGrid, /minWidth: dayKeys\.length > 1 \? 900/);
  assert.match(scheduleGrid, /className="hidden"/);
  assert.match(scheduleGrid, /selectedRangeTop/);
  assert.match(scheduleGrid, /selectedRange\.durationMin/);
  assert.doesNotMatch(scheduleGrid, /Selected range:/);
  assert.match(action, /z\.coerce\.number\(\)\.int\(\)\.min\(1\)\.max\(10\)/);
  assert.match(migration, /rubric_scores jsonb/);
  assert.match(migration, /section_comments jsonb/);
  assert.match(studentPage, /report\.rubric_scores/);
  assert.match(calendarPage, /nextLessonAt/);
  assert.match(calendar, /Next lesson:/);
  assert.doesNotMatch(calendar, /Student details<\/Link>/);
  assert.match(studentPage, /studentSessionsComplete/);
  assert.match(studentPage, /Download overall report PDF/);
  assert.match(pdf, /studentSessionsComplete/);
  assert.match(csv, /Skill ratings|rubricHeaders/);
  assert.match(pdf, /assessment\.section_comments/);
});

test("passwordless admin bypass is limited to loopback hosts in development", () => {
  assert.equal(isLocalAdminBypassEnabled("development", "localhost:3010"), true);
  assert.equal(isLocalAdminBypassEnabled("development", "127.0.0.1:3010"), true);
  assert.equal(isLocalAdminBypassEnabled("development", "[::1]:3010"), true);
  assert.equal(isLocalAdminBypassEnabled("production", "localhost:3010"), false);
  assert.equal(isLocalAdminBypassEnabled("development", "wisdomdrivingacademy.com"), false);
  assert.equal(isLocalAdminBypassEnabled("development", "localhost.evil.example"), false);
  const proxy = readFileSync(new URL("../src/proxy.ts", import.meta.url), "utf8");
  const adminGate = readFileSync(new URL("../src/lib/auth/require-admin.ts", import.meta.url), "utf8");
  assert.match(proxy, /isLocalAdminBypassEnabled\(process\.env\.NODE_ENV, request\.nextUrl\.hostname\)/);
  assert.match(adminGate, /isLocalAdminBypassEnabled\(process\.env\.NODE_ENV, requestHeaders\.get\("host"\)/);
  assert.match(adminGate, /supabase\.auth\.getUser\(\)/);
  assert.match(adminGate, /redirect\(`\/admin\/login/);
  assert.match(adminGate, /process\.env\.NODE_ENV === "production"/);
});

test("cash payment and expired-hold validation apply only to the selected lesson", () => {
  const migration = readFileSync(new URL("../supabase/migrations/0044_cash_payment_per_lesson.sql", import.meta.url), "utf8");
  const fileStore = readFileSync(new URL("../src/lib/booking/file-store.ts", import.meta.url), "utf8");
  const action = readFileSync(new URL("../src/app/admin/(panel)/bookings/actions.ts", import.meta.url), "utf8");
  assert.match(migration, /where id = p_booking_id and payment_status = 'due'/);
  assert.match(migration, /if v_booking\.status = 'pending_payment'[\s\S]*?v_booking\.stripe_checkout_expires_at/);
  assert.doesNotMatch(migration, /update public\.bookings[\s\S]{0,250}where coalesce\(package_id, id\)/);
  assert.match(fileStore, /paymentStatus === "paid"\s*\? \[booking\]/);
  assert.match(action, /This lesson’s unpaid hold expired and its time is no longer available/);
});

test("admin dashboard exposes manual booking and working payment and package management paths", () => {
  const dashboard = readFileSync(new URL("../src/app/admin/(panel)/page.tsx", import.meta.url), "utf8");
  const dashboardBooking = readFileSync(new URL("../src/app/admin/(panel)/dashboard-add-booking.tsx", import.meta.url), "utf8");
  const bookingWizard = readFileSync(new URL("../src/components/booking/booking-wizard.tsx", import.meta.url), "utf8");
  const adminBundleAction = readFileSync(new URL("../src/app/admin/(panel)/bookings/admin-bundle-action.ts", import.meta.url), "utf8");
  const calendar = readFileSync(new URL("../src/app/admin/(panel)/calendar/page.tsx", import.meta.url), "utf8");
  const lessonsEditor = readFileSync(new URL("../src/app/admin/(panel)/lessons/lessons-editor.tsx", import.meta.url), "utf8");
  const lessonForm = readFileSync(new URL("../src/app/admin/(panel)/lessons/lesson-form.tsx", import.meta.url), "utf8");
  const lessonAction = readFileSync(new URL("../src/app/admin/(panel)/lessons/actions.ts", import.meta.url), "utf8");
  const stripeFulfillment = readFileSync(new URL("../src/lib/stripe/fulfill.ts", import.meta.url), "utf8");
  const payments = readFileSync(new URL("../src/app/admin/(panel)/payments/page.tsx", import.meta.url), "utf8");
  assert.match(dashboard, /<DashboardAddBooking lessons=/);
  assert.match(dashboardBooking, /\+ Add booking/);
  assert.match(dashboardBooking, /<BookingWizard lessons=\{lessons\} adminMode/);
  assert.match(bookingWizard, /import \{ LessonStep \}/);
  assert.match(bookingWizard, /import \{ DateTimeStep \}/);
  assert.match(bookingWizard, /import \{ DetailsStep/);
  assert.match(adminBundleAction, /store\.createBookingBundle\(/);
  assert.match(adminBundleAction, /updateBookingStatus\(created\.value\[0\]\.id, "confirmed"\)/);
  assert.match(dashboard, /href="\/admin\/payments" title="Payment reports"/);
  assert.match(calendar, /DayBookingsAccordion entries=\{dayBookingEntries\}/);
  assert.doesNotMatch(calendar, /Quick guide/);
  assert.doesNotMatch(calendar, /\[\("week", "day", "month"\)/);
  assert.match(dashboardBooking, /<BookingWizard lessons=\{lessons\} adminMode/);
  assert.match(lessonsEditor, /\+ Add package/);
  assert.match(lessonForm, /name="isNew"/);
  assert.match(lessonAction, /store\.saveLesson\(/);
  assert.match(stripeFulfillment, /handleStripeCheckoutEvent\(/);
  assert.match(payments, /mode === "unconfigured"/);
});

test("admin calendar supports custom conflict-checked times and confirms moves before emailing", () => {
  const calendarAction = readFileSync(new URL("../src/app/admin/(panel)/calendar/actions.ts", import.meta.url), "utf8");
  const quickBook = readFileSync(new URL("../src/app/admin/(panel)/calendar/quick-book-dialog.tsx", import.meta.url), "utf8");
  const scheduleGrid = readFileSync(new URL("../src/app/admin/(panel)/calendar/schedule-grid.tsx", import.meta.url), "utf8");
  const monthGrid = readFileSync(new URL("../src/app/admin/(panel)/calendar/month-grid.tsx", import.meta.url), "utf8");
  const bookingAction = readFileSync(new URL("../src/app/admin/(panel)/bookings/actions.ts", import.meta.url), "utf8");
  const bookingActions = readFileSync(new URL("../src/app/admin/(panel)/bookings/booking-actions.tsx", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/0049_admin_flexible_calendar_times.sql", import.meta.url), "utf8");
  assert.match(calendarAction, /store\.createAdminBooking\(/);
  assert.match(quickBook, /Choose any time you need/);
  assert.match(scheduleGrid, /const SLOT_STEP_MIN = 10/);
  assert.match(scheduleGrid, /Review change/);
  assert.match(scheduleGrid, /Confirm move/);
  assert.match(scheduleGrid, /Choose a future date and time/);
  assert.match(scheduleGrid, /⚠ Past — mark complete or no-show/);
  assert.match(monthGrid, /⚠ Needs update/);
  assert.match(bookingAction, /That time overlaps another lesson/);
  assert.match(bookingAction, /startMs <= Date\.now\(\)/);
  assert.match(bookingActions, /min=\{dayKeyOf\(new Date\(currentNowMs\)/);
  assert.match(bookingActions, /startsAt\.getTime\(\) > Date\.now\(\)/);
  assert.match(migration, /public\.booking_overlaps\(p_starts_at, p_ends_at, v_target\.id\)/);
  assert.match(migration, /set_config\('app\.admin_calendar_override', 'on', true\)/);
});

test("admin package calendar holds allow selected future times but remain admin-gated and conflict checked", () => {
  const holdRoute = readFileSync(new URL("../src/app/api/bookings/hold/route.ts", import.meta.url), "utf8");
  const wizard = readFileSync(new URL("../src/components/booking/booking-wizard.tsx", import.meta.url), "utf8");
  const bundleAction = readFileSync(new URL("../src/app/admin/(panel)/bookings/admin-bundle-action.ts", import.meta.url), "utf8");
  const store = readFileSync(new URL("../src/lib/booking/supabase-store.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/0051_admin_calendar_package_holds.sql", import.meta.url), "utf8");
  assert.match(holdRoute, /x-admin-calendar-booking/);
  assert.match(holdRoute, /await requireAdmin\("\/admin\/calendar"\)/);
  assert.match(holdRoute, /if \(adminOverride\)/);
  assert.match(holdRoute, /This lesson overlaps another booking or active hold at/);
  assert.match(wizard, /x-admin-calendar-booking/);
  assert.match(bundleAction, /holdHash, true\)/);
  assert.match(store, /adminOverride \? "admin_hold_booking_slots"/);
  assert.match(store, /adminOverride \? "admin_create_booking_bundle_with_student_details"/);
  assert.match(migration, /public\.booking_overlaps\(/);
  assert.match(migration, /set_config\('app\.admin_calendar_override', 'on', true\)/);
  assert.match(migration, /admin_hold_booking_slots/);
  assert.match(migration, /admin_create_booking_bundle_with_student_details/);
});
