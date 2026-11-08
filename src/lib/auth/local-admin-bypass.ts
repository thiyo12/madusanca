/** Permit passwordless admin access only for a local development browser. */
export function isLocalAdminBypassEnabled(nodeEnv: string | undefined, host: string): boolean {
  if (nodeEnv !== "development" || !host || host.length > 255) return false;

  try {
    const hostname = new URL(`http://${host}`).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}
