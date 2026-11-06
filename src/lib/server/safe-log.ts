/** Log only error class and a constrained provider code; never messages or payloads. */
export function logSafeError(context: string, error: unknown): void {
  const value = typeof error === "object" && error !== null
    ? error as { name?: unknown; code?: unknown; type?: unknown; statusCode?: unknown }
    : undefined;
  const name = typeof value?.name === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(value.name)
    ? value.name
    : "UnknownError";
  const code = typeof value?.code === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(value.code)
    ? value.code
    : undefined;
  const type = typeof value?.type === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(value.type)
    ? value.type
    : undefined;
  const statusCode = typeof value?.statusCode === "number" && Number.isInteger(value.statusCode) && value.statusCode >= 100 && value.statusCode <= 599
    ? value.statusCode
    : undefined;
  console.error(context, { name, ...(code ? { code } : {}), ...(type ? { type } : {}), ...(statusCode ? { statusCode } : {}) });
}
