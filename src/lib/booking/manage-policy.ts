export const SELF_SERVICE_CUTOFF_MS = 48 * 60 * 60 * 1000;

/** Rescheduling eligibility is evaluated for one session, never its package. */
export function isInsideSelfServiceWindow(startsAt: string, nowMs = Date.now()): boolean {
  const startsAtMs = Date.parse(startsAt);
  return Number.isFinite(startsAtMs) && startsAtMs - nowMs < SELF_SERVICE_CUTOFF_MS;
}
