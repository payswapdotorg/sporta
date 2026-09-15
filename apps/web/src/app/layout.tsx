import type { Metadata, Viewport } from "next";
import "./globals.css";
import { A11Y, SKIP_LINK_HREF } from "@/lib/a11y";
import { BRAND } from "@/lib/brand";
import { SiteHeader } from "@/components/site-header";
import { SiteSidebar } from "@/components/site-sidebar";
import { MobileTabbar } from "@/components/mobile-tabbar";
import { SiteFooter } from "@/components/site-footer";
import { ServiceWorkerRegistrar } from "@/components/service-worker-registrar";

export const metadata: Metadata = {
  applicationName: BRAND.name,
  title: {
    default: `${BRAND.name} — ${BRAND.tagline}`,
    template: `%s · ${BRAND.name}`,
  },
  description: BRAND.description,
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    title: BRAND.shortName,
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: BRAND.themeColor,
};

/**
 * Root layout of the Sporta product shell (W903).
 *
 * Accessibility baseline baked into the frame: skip-to-content link,
 * semantic landmarks (header / nav / main / footer), a focusable main
 * landmark as the skip target, and a footer pinned to the bottom of the
 * flex app frame (`margin-top: auto`) with no floating gap.
 */
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href={SKIP_LINK_HREF}>
          {A11Y.skipLinkText}
        </a>
        <div className="app-frame">
          <SiteHeader />
          <div className="app-body">
            <SiteSidebar />
            <main id={A11Y.mainId} className="main-content" tabIndex={-1}>
              {children}
            </main>
          </div>
          <SiteFooter />
          <MobileTabbar />
        </div>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
