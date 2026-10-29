import { getPublicOrigin, SITE_NAME } from "@/lib/seo/metadata";

const serviceAreas = ["Burnaby", "Vancouver", "Richmond"].map((name) => ({
  "@type": "City",
  name,
  containedInPlace: {
    "@type": "AdministrativeArea",
    name: "British Columbia",
  },
}));

export function BusinessJsonLd() {
  const origin = getPublicOrigin();
  const businessId = origin ? `${origin}#business` : undefined;
  const organization = {
    "@type": ["Organization", "LocalBusiness"],
    ...(businessId ? { "@id": businessId, url: origin?.toString() } : {}),
    name: SITE_NAME,
    description:
      "One-on-one driving lessons and road-test preparation in Burnaby, Vancouver and Richmond, British Columbia.",
    telephone: "+1-236-234-3229",
    email: "info@wisdomdrivingacademy.com",
    areaServed: serviceAreas,
    ...(origin ? { logo: new URL("/wisdom-logo.png", origin).toString() } : {}),
  };
  const website = origin
    ? {
        "@type": "WebSite",
        "@id": `${origin}#website`,
        name: SITE_NAME,
        url: origin.toString(),
        publisher: { "@id": businessId },
        inLanguage: "en-CA",
      }
    : undefined;
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [organization, ...(website ? [website] : [])],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
      }}
    />
  );
}
