import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-admin";
import { listContactMessages } from "@/lib/admin/contact-inbox";
import { setContactMessageReadAction } from "./actions";

export const metadata: Metadata = {
  title: "Inbox — Wisdom Driving Academy Admin",
};

export const dynamic = "force-dynamic";

export default async function AdminInboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin("/admin/inbox");
  const params = await searchParams;
  const requestedPage = Number(typeof params.page === "string" ? params.page : "1");
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const unreadOnly = params.unread === "1";
  const error = typeof params.error === "string" ? params.error : "";

  let result = await listContactMessages(page, unreadOnly);
  const actualPage = Math.min(page, result.pageCount);
  if (actualPage !== page) result = await listContactMessages(actualPage, unreadOnly);

  function pageHref(nextPage: number, unread = unreadOnly): string {
    const query = new URLSearchParams({ page: String(nextPage) });
    if (unread) query.set("unread", "1");
    return `/admin/inbox?${query.toString()}`;
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-gold-deep">Admin</p>
          <h1 className="mt-2 font-display text-[27px] font-extrabold leading-tight text-ink sm:text-3xl">Contact inbox</h1>
          <p className="mt-1 text-[12.5px] text-soft">
            Website messages are saved here. Call the sender using the number they provided; no notification email is sent.
          </p>
        </div>
        <p className="rounded-full bg-[#fff9e9] px-3 py-1.5 text-[12px] font-extrabold text-[#735c1e]">
          {result.unreadCount} unread
        </p>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-lg border border-[#f3d1c9] bg-[#fff5f2] px-4 py-3 text-sm font-semibold text-[#bc4633]">
          {error === "not-found" ? "That message could not be found." : "The message action was invalid. Please try again."}
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Link
          href={pageHref(1, false)}
          aria-current={!unreadOnly ? "page" : undefined}
          className={`rounded-full px-3.5 py-2 text-xs font-extrabold ${!unreadOnly ? "bg-ink text-white" : "border border-line bg-white text-soft"}`}
        >
          All messages
        </Link>
        <Link
          href={pageHref(1, true)}
          aria-current={unreadOnly ? "page" : undefined}
          className={`rounded-full px-3.5 py-2 text-xs font-extrabold ${unreadOnly ? "bg-ink text-white" : "border border-line bg-white text-soft"}`}
        >
          Unread ({result.unreadCount})
        </Link>
        <span className="ml-auto text-xs text-soft">
          {result.total === 0 ? "No messages" : `Page ${actualPage} of ${result.pageCount} · ${result.total} ${unreadOnly ? "unread " : ""}messages`}
        </span>
      </div>

      {result.messages.length === 0 ? (
        <div className="mt-4 rounded-[16px] border border-line bg-white px-5 py-14 text-center">
          <h2 className="font-display text-lg font-extrabold text-ink">{unreadOnly ? "No unread messages" : "Your inbox is empty"}</h2>
          <p className="mt-2 text-sm text-soft">{unreadOnly ? "You’re all caught up." : "New website contact messages will appear here."}</p>
        </div>
      ) : (
        <div className="mt-4 grid gap-3">
          {result.messages.map((message) => (
            <article key={message.id} className={`rounded-[16px] border bg-white p-4 sm:p-5 ${message.is_read ? "border-line" : "border-[#e8d99f] shadow-[0_4px_18px_rgba(80,64,22,0.06)]"}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-display text-base font-extrabold text-ink">{message.name}</h2>
                    {!message.is_read && <span className="rounded-full bg-[#fff4d6] px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-[#735c1e]">Unread</span>}
                  </div>
                  <p className="mt-1 text-xs text-soft">
                    {new Date(message.created_at).toLocaleString("en-CA", { timeZone: "America/Vancouver", dateStyle: "medium", timeStyle: "short" })} Pacific
                  </p>
                </div>
                <form action={setContactMessageReadAction}>
                  <input type="hidden" name="id" value={message.id} />
                  <input type="hidden" name="isRead" value={String(!message.is_read)} />
                  <input type="hidden" name="page" value={String(actualPage)} />
                  <input type="hidden" name="unread" value={String(unreadOnly)} />
                  <button type="submit" className="rounded-lg border border-line px-3 py-2 text-[11px] font-extrabold text-ink hover:bg-mist">
                    Mark {message.is_read ? "unread" : "read"}
                  </button>
                </form>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px]">
                <a href={`tel:${message.phone.replace(/[^\d+]/g, "")}`} className="font-extrabold text-[#426a2c] underline underline-offset-2">Call {message.phone}</a>
                <a href={`mailto:${message.email}`} className="font-semibold text-ink underline underline-offset-2">{message.email}</a>
              </div>
              <h3 className="mt-4 text-sm font-extrabold text-ink">{message.subject || "No subject"}</h3>
              <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-[#4b525e]">{message.message}</p>
            </article>
          ))}
        </div>
      )}

      {result.pageCount > 1 && (
        <nav className="mt-5 flex items-center justify-between" aria-label="Inbox pages">
          {actualPage > 1
            ? <Link href={pageHref(actualPage - 1)} className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-bold text-ink">← Newer</Link>
            : <span />}
          {actualPage < result.pageCount
            ? <Link href={pageHref(actualPage + 1)} className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-bold text-ink">Older →</Link>
            : <span />}
        </nav>
      )}
    </div>
  );
}
