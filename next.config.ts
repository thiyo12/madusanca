import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  async headers() {
    const commonHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
      { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
    ];
    return [
      {
        source: "/:path*",
        headers: [
          ...commonHeaders,
        ],
      },
      { source: "/booking/manage", headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }] },
      { source: "/admin/reset-password", headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }] },
      { source: "/admin/:path*", headers: [
        { key: "Cache-Control", value: "private, no-store, max-age=0" },
        { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
      ] },
      { source: "/booking/manage", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }] },
      { source: "/api/bookings/:path*", headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }] },
      { source: "/api/stripe/:path*", headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }] },
      { source: "/auth/confirm", headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }] },
    ];
  },
  images: {
    domains: [],
  },
};

export default nextConfig;
