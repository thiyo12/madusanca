export function pickupLocation(notes: string): string | null {
  const line = notes.split(/\r?\n/).find((item) => /^Pickup address:\s*/i.test(item));
  return line?.replace(/^Pickup address:\s*/i, "").trim() || null;
}
