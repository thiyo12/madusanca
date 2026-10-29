/** Simple in-memory sliding-window rate limiter (per server instance). */

interface Window {
  hits: number[];
}

const buckets = new Map<string, Window>();

/**
 * Records a hit for `key` and returns true when the limit is exceeded.
 * @param maxHits maximum requests allowed within the window
 * @param windowMs window length in milliseconds
 */
export function isRateLimited(key: string, maxHits: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { hits: [] };
  const recent = bucket.hits.filter((t) => now - t < windowMs);

  if (recent.length >= maxHits) {
    buckets.set(key, { hits: recent });
    return true;
  }

  recent.push(now);
  buckets.set(key, { hits: recent });

  // Opportunistic cleanup so the map cannot grow without bound.
  if (buckets.size > 1000) {
    for (const [k, v] of buckets) {
      if (v.hits.every((t) => now - t >= windowMs)) buckets.delete(k);
    }
  }
  return false;
}

export function clientIp(request: Request): string {
  // Only use forwarded headers when explicitly enabled behind a trusted
  // single reverse proxy that overwrites (not appends) X-Real-IP.
  if (process.env.TRUST_PROXY_IP === "true") {
    const forwarded = request.headers.get("x-real-ip")?.trim();
    if (forwarded && /^[\da-fA-F:.]+$/.test(forwarded)) return forwarded;
  }
  return "unknown";
}
