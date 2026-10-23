# Original Prototype and Booking Reference — Safe Requirements Brief

This file records product/design requirements from the owner's supplied materials. **Source materials are not committed to GitHub** because the screenshot contains credentials.

## Original website ZIP: `wisdom-academy-netlify-ready.zip`
- Archive includes one `index.html` (self-contained interactive front-end prototype).
- Branding: **Wisdom Driving Academy**; original headline emphasizes a journey to confident driving.
- Information architecture includes home/hero, driving lesson choices, explanation of booking steps, progress/benefits, FAQs, contact, calls to action and student-facing booking screens.
- Demonstrated booking sequence: choose lesson -> pick a date/time -> enter student details -> confirmation. Prototype explicitly uses a **demo confirmation**, NOT persistent booking.
- Prototype hints at rescheduling, but no verified secure booking backend/calendar or payment transaction exists.
- Reuse useful content hierarchy and interactions as inspiration; rebuild as accessible reusable Next.js components, not pasted monolithic HTML.
- Improve visual identity: cinematic authentic road/driving hero, contemporary navy/blue/white palette, refined typography and smooth restrained motion, accessible on mobile and with reduced motion.

## BookingTimes screenshot
- It is an account sign-in screen, NOT a view of the administrator booking calendar.
- It includes private login information: **do not transcribe, reuse, commit, display, screenshot, or attempt to sign in with those credentials**. Owner should rotate the visible password.
- Calendar functionality requirements come from owner's instructions rather than a verified view of the reference system.

## Required future booking functionality
- Administrator day/week/month appointment calendar, instructor filtering, schedule changes, availability exceptions and audit log.
- Instructor and vehicle slot conflict protection enforced by backend/database, not visual-only calendar rules.
- Student guest booking with email confirmations and safe cancellation/rescheduling from time-limited one-use links.
- Atomic rescheduling; never lose the original appointment if a change fails.
- Accurate Canadian business timezone and daylight-saving handling.
- Optional Stripe in CAD with validated webhooks and safe payment states.
- Production privacy, security and provincial legal review.

## Scope reminder
Phase 1 builds polished public website/foundation locally. Later phases implement real backend, booking/payment and deploy after testing. Do not label simulated booking or placeholder content as live.
