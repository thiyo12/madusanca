const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function supabaseOrigin(value: string | undefined): string {
  if (!value) return "";

  try {
    const url = new URL(value);
    if (url.protocol === "https:") return url.origin;
    if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)) return url.origin;
  } catch {
    return "";
  }

  return "";
}
