import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Local fallback limiter; production requests use the shared Supabase counter. */

interface Window {
  hits: number[];
}

const buckets = new Map<string, Window>();
let sharedClient: SupabaseClient | null = null;

function getSharedClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  sharedClient ??= createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return sharedClient;
}

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

/** Shared fixed-window limit. Errors fail closed; never silently downgrade in production. */
export async function isRateLimitedShared(key: string, maxHits: number, windowMs: number): Promise<boolean> {
  try {
    const client = getSharedClient();
    if (!client) {
      return process.env.NODE_ENV === "production"
        ? true
        : isRateLimited(key, maxHits, windowMs);
    }
    const keyHash = createHash("sha256").update(key).digest("hex");
    const { data, error } = await client.rpc("consume_rate_limit", {
      p_key_hash: keyHash,
      p_max_hits: maxHits,
      p_window_ms: windowMs,
    });
    if (!error && typeof data === "boolean") return data;
    console.error("[security/rate-limit] shared limiter unavailable");
    return true;
  } catch {
    console.error("[security/rate-limit] shared limiter unavailable");
    return true;
  }
}

/**
 * Apply an IP bucket only when the address came from an explicitly trusted
 * proxy. Never put all anonymous traffic into a shared "unknown" bucket: that
 * would let one visitor exhaust the site's global allowance.
 */
export async function isIpRateLimitedShared(
  request: Request,
  namespace: string,
  maxHits: number,
  windowMs: number,
): Promise<boolean> {
  const ip = clientIp(request);
  if (ip === "unknown") return false;
  return isRateLimitedShared(`${namespace}:${ip}`, maxHits, windowMs);
}

export function clientIp(request: Request): string {
  // Only use forwarded headers when explicitly enabled behind a trusted
  // single reverse proxy that overwrites (not appends) X-Real-IP.
  if (process.env.TRUST_PROXY_IP === "true") {
    const forwarded = request.headers.get("x-real-ip")?.trim();
    if (forwarded && isIP(forwarded) !== 0) return forwarded;
  }
  return "unknown";
}
