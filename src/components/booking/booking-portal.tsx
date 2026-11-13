"use client";

import { useState } from "react";
import { BookingFind, type BookingAction } from "@/components/booking/booking-find";
import { BookingManage } from "@/components/booking/booking-manage";

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
  const [showManage, setShowManage] = useState(hasManageCookie);
  const [activeReference, setActiveReference] = useState(selectedReference);
  const [activeAction, setActiveAction] = useState<BookingAction>("details");
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>();
  const [refreshVersion, setRefreshVersion] = useState(0);

  function openManage(reference: string, action: BookingAction, sessionId?: string) {
    setActiveReference(reference);
    setActiveAction(action);
    setActiveSessionId(sessionId);
    setShowManage(true);
  }

  async function backToBookings() {
    await fetch("/api/bookings/session", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
    setShowManage(false);
  }

  return (
    <>
      <div hidden={showManage}>
        <BookingFind onOpenManage={openManage} refreshVersion={refreshVersion} />
      </div>
      {showManage && (
        <BookingManage
          key={`${activeReference}:${activeAction}:${activeSessionId ?? ""}:${paymentReturn ?? ""}:${packagePurchaseAdded ? "purchase" : ""}`}
          paymentReturn={paymentReturn}
          packagePurchaseAdded={packagePurchaseAdded}
          initialAction={activeAction}
          initialSessionId={activeSessionId}
          onBackToBookings={!hasManageCookie ? backToBookings : undefined}
          onBookingUpdated={() => setRefreshVersion((version) => version + 1)}
        />
      )}
    </>
  );
}
