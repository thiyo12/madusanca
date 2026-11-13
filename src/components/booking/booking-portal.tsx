"use client";

import { useState } from "react";
import { BookingFind } from "@/components/booking/booking-find";
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

  function openManage(reference: string) {
    setActiveReference(reference);
    setShowManage(true);
  }

  async function backToBookings() {
    await fetch("/api/bookings/session", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
    setShowManage(false);
  }

  return (
    <>
      <div hidden={showManage}>
        <BookingFind onOpenManage={openManage} />
      </div>
      {showManage && (
        <BookingManage
          key={`${activeReference}:${paymentReturn ?? ""}:${packagePurchaseAdded ? "purchase" : ""}`}
          paymentReturn={paymentReturn}
          packagePurchaseAdded={packagePurchaseAdded}
          onBackToBookings={!hasManageCookie ? backToBookings : undefined}
        />
      )}
    </>
  );
}
