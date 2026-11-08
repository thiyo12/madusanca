"use client";

export function PrintReportButton() {
  return <button type="button" onClick={() => window.print()} className="rounded-lg border border-line px-3 py-2 text-xs font-bold text-ink print:hidden">Print final report</button>;
}
