import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Manrope, DM_Sans } from "next/font/google";
import { connection } from "next/server";
import { rootMetadata } from "@/lib/seo/metadata";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  display: "swap",
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = rootMetadata();

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Per-request CSP nonces require request-time rendering, never a build-time value.
  await connection();
  return (
    <html
      lang="en-CA"
      className={`${manrope.variable} ${dmSans.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
