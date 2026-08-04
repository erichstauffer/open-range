import type { Metadata, Viewport } from "next";
import "./globals.css";

/**
 * Absolute base for social metadata.
 *
 * Crawlers will not resolve a relative `og:image`, so Next needs a
 * `metadataBase` to build one. Vercel injects the project's production domain at
 * build time; the literal is the fallback for local runs and for anywhere the
 * variable is absent.
 */
const siteUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "https://open-range-erichstauffer.vercel.app";

const description =
  "A top-down exploration game whose every tile, sprite, landmark and place name is generated in code from one constrained palette. No image files shipped.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Open Range",
  description,
  openGraph: {
    type: "website",
    siteName: "Open Range",
    title: "Open Range",
    description,
    url: "/",
    images: [
      {
        // A real frame of a real generated world, rendered by the game's own
        // atlas — see scripts/render-og-image.ts.
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "A generated island in Open Range: sea, shallows, sand, meadow, bramble, bare highland and snow, with the title Open Range set in a pixel font.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Open Range",
    description,
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#16150f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
