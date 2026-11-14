"use client";

import { useCallback, useEffect, useState } from "react";
import { BookingFind, type BookingAction } from "@/components/booking/booking-find";
import { BookingManage } from "@/components/booking/booking-manage";
import { clearManageAddonSelection } from "@/lib/booking/manage-session-client";

interface BookingPortalProps {
  hasManageCookie: boolean;
  paymentReturn?: string;
  packagePurchaseAdded?: boolean;
  selectedReference?: string;
}

/** Keeps email verification, booking selection, and lesson management in one page. */
export function BookingPortal({
  hasManageCookie,
  paymentReturn,
  packagePurchaseAdded,
  selectedReference = "",
}: BookingPortalProps) {
  const successfulAddonReturn = packagePurchaseAdded && paymentReturn === "success";
  const [showManage, setShowManage] = useState(hasManageCookie && !successfulAddonReturn);
  const [activeReference, setActiveReference] = useState(selectedReference);
  const [activeAction, setActiveAction] = useState<BookingAction>(
    packagePurchaseAdded && paymentReturn === "cancelled" ? "addons" : "details",
  );
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>();
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [returnSessionReady, setReturnSessionReady] = useState(!successfulAddonReturn);

  const clearReturnSession = useCallback(() => fetch("/api/bookings/session", {
    method: "POST",
    credentials: "same-origin",
  }), []);

  useEffect(() => {
    if (!successfulAddonReturn) return;
    // Require the same email + OTP verification as a fresh My Booking visit.
    clearManageAddonSelection();
    void clearReturnSession()
      .then((response) => setReturnSessionReady(response.ok))
      .catch(() => setReturnSessionReady(false));
  }, [successfulAddonReturn, clearReturnSession]);

  function openManage(reference: string, action: BookingAction, sessionId?: string) {
    setActiveReference(reference);
    setActiveAction(action);
    setActiveSessionId(sessionId);
    setShowManage(true);
  }

  const backToBookings = useCallback(async () => {
    // This is an in-session return to the already-verified lesson history,
    // not a logout. Keep the short-lived manage cookie so the student can
    // open another lesson or start the add-on flow without re-entering OTP.
    setShowManage(false);
    setActiveReference("");
    setActiveAction("details");
    setActiveSessionId(undefined);
  }, []);

  return (
    <>
      <div hidden={showManage}>
        {successfulAddonReturn && (
          <p role="status" className="mb-4 rounded-[14px] border border-[#cce6b1] bg-[#f1f9e9] px-4 py-3 text-[13px] font-semibold leading-relaxed text-[#385a22]">
            Payment completed. Enter your email and verify the code to view your updated My Booking lessons.
          </p>
        )}
        {returnSessionReady ? (
          <BookingFind onOpenManage={openManage} refreshVersion={refreshVersion} />
        ) : successfulAddonReturn ? (
          <div role="status" className="grid gap-3 rounded-[14px] border border-line bg-white p-4 text-[13px] text-soft">
            <p>Preparing secure email verification…</p>
            <button type="button" onClick={() => {
              clearManageAddonSelection();
              void clearReturnSession()
                .then((response) => setReturnSessionReady(response.ok))
                .catch(() => setReturnSessionReady(false));
            }} className="w-fit font-bold text-gold-deep underline underline-offset-2">
              Try again
            </button>
          </div>
        ) : null}
      </div>
      {showManage && (
        <BookingManage
          key={`${activeReference}:${activeAction}:${activeSessionId ?? ""}:${paymentReturn ?? ""}:${packagePurchaseAdded ? "purchase" : ""}`}
          paymentReturn={paymentReturn}
          packagePurchaseAdded={packagePurchaseAdded}
          initialAction={activeAction}
          initialSessionId={activeSessionId}
          onBackToBookings={backToBookings}
          onBookingUpdated={() => setRefreshVersion((version) => version + 1)}
        />
      )}
    </>
  );
}
