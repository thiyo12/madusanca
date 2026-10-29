import type { Metadata } from "next";

export const SITE_NAME = "Wisdom Driving Academy";
export const DEFAULT_DESCRIPTION =
  "One-on-one driving lessons and road-test preparation in Burnaby, Vancouver and Richmond, British Columbia.";
export const OPEN_GRAPH_IMAGE = "/opengraph-image";

function configuredOrigin(): URL | undefined {
  const configured = process.env.NEXT_PUBLIC_CANONICAL_ORIGIN?.trim();
  if (!configured) return undefined;

  try {
    const url = new URL(configured);
    const host = url.hostname.toLowerCase();
    const isLocal =
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host === "127.0.0.1" ||
      host === "::1" ||
      !host.includes(".");
    const isPreviewHost = host.endsWith(".vercel.app");

    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      isLocal ||
      isPreviewHost ||
      (process.env.NODE_ENV === "production" && url.protocol !== "https:")
    ) {
      return undefined;
    }

    return new URL(url.origin);
  } catch {
    return undefined;
  }
}

export function getPublicOrigin(): URL | undefined {
  return configuredOrigin();
}

export function isPublicIndexingEnabled(): boolean {
  return (
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PUBLIC_SEO_INDEXING_ENABLED === "true" &&
    configuredOrigin() !== undefined
  );
}

function fullTitle(title: string): string {
  return `${title} | ${SITE_NAME}`;
}

function robotsMetadata(): NonNullable<Metadata["robots"]> {
  if (!isPublicIndexingEnabled()) return { index: false, follow: false };
  return {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  };
}

export function rootMetadata(): Metadata {
  const origin = configuredOrigin();
  const googleVerification = process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION?.trim();
  const bingVerification = process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION?.trim();
  return {
    metadataBase: origin,
    title: {
      default: "Driving Lessons in Metro Vancouver, BC",
      template: `%s | ${SITE_NAME}`,
    },
    description: DEFAULT_DESCRIPTION,
    applicationName: SITE_NAME,
    alternates: origin ? { canonical: origin.toString() } : undefined,
    openGraph: {
      type: "website",
      locale: "en_CA",
      siteName: SITE_NAME,
      title: fullTitle("Driving Lessons in Metro Vancouver, BC"),
      description: DEFAULT_DESCRIPTION,
      url: origin?.toString(),
      ...(origin
        ? { images: [{ url: OPEN_GRAPH_IMAGE, width: 1200, height: 630, alt: `${SITE_NAME} — driving lessons in British Columbia` }] }
        : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle("Driving Lessons in Metro Vancouver, BC"),
      description: DEFAULT_DESCRIPTION,
      ...(origin ? { images: [OPEN_GRAPH_IMAGE] } : {}),
    },
    robots: robotsMetadata(),
    verification:
      googleVerification || bingVerification
        ? {
            ...(googleVerification ? { google: googleVerification } : {}),
            ...(bingVerification ? { other: { "msvalidate.01": bingVerification } } : {}),
          }
        : undefined,
  };
}

export function publicPageMetadata({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  const origin = configuredOrigin();
  const pageUrl = origin ? new URL(path, origin).toString() : undefined;
  const pageTitle = fullTitle(title);

  return {
    title,
    description,
    alternates: pageUrl ? { canonical: pageUrl } : undefined,
    openGraph: {
      type: "website",
      locale: "en_CA",
      siteName: SITE_NAME,
      title: pageTitle,
      description,
      url: pageUrl,
      ...(origin
        ? { images: [{ url: OPEN_GRAPH_IMAGE, width: 1200, height: 630, alt: `${SITE_NAME} — driving lessons in British Columbia` }] }
        : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: pageTitle,
      description,
      ...(origin ? { images: [OPEN_GRAPH_IMAGE] } : {}),
    },
    robots: robotsMetadata(),
  };
}

export function noIndexPageMetadata(title: string, description: string): Metadata {
  return {
    title,
    description,
    robots: { index: false, follow: false },
  };
}
