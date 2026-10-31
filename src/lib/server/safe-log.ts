/** Log only error class and a constrained provider code; never messages or payloads. */
export function logSafeError(context: string, error: unknown): void {
  const value = typeof error === "object" && error !== null
    ? error as { name?: unknown; code?: unknown }
    : undefined;
  const name = typeof value?.name === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(value.name)
    ? value.name
    : "UnknownError";
  const code = typeof value?.code === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(value.code)
    ? value.code
    : undefined;
  console.error(context, { name, ...(code ? { code } : {}) });
}
