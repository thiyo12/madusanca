import type { ReactNode } from "react";
import { Navigation } from "@/components/layout/navigation";
import { Footer } from "@/components/layout/footer";
import { MotionConfig } from "framer-motion";

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <div className="public-site flex min-h-screen flex-col">
        <Navigation />
        <main className="flex flex-1 flex-col">{children}</main>
        <Footer />
      </div>
    </MotionConfig>
  );
}
