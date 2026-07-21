import type { Metadata } from "next";
import Script from "next/script";
import { Plus_Jakarta_Sans, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { RootProvider } from "fumadocs-ui/provider/next";
import DefaultSearchDialog from "@/components/search";
import CookieConsentBanner from "@/components/CookieConsent";
import { absoluteUrl, siteUrl } from "@/lib/site";
import { THEME_STORAGE_KEY } from "@/lib/theme";

const sans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sans",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-mono",
});

const displayFont = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: {
    default: "hypequery | The TypeScript Analytics Layer for ClickHouse",
    template: "%s | hypequery",
  },
  description: "Define ClickHouse metrics once in TypeScript, then reuse them across APIs, jobs, dashboards, and AI agents.",
  alternates: {
    canonical: absoluteUrl('/'),
  },
  openGraph: {
    type: 'website',
    url: absoluteUrl('/'),
    title: 'hypequery | The TypeScript Analytics Layer for ClickHouse',
    description: 'Define ClickHouse metrics once in TypeScript, then reuse them across APIs, jobs, dashboards, and AI agents.',
    siteName: 'hypequery',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'hypequery | The TypeScript Analytics Layer for ClickHouse',
    description: 'Define ClickHouse metrics once in TypeScript, then reuse them across APIs, jobs, dashboards, and AI agents.',
  },
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
      { url: "/favicon-48x48.png", type: "image/png", sizes: "48x48" },
      { url: "/icon.png", type: "image/png", sizes: "500x500" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

const gaMeasurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

const organizationSchema = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': absoluteUrl('/#organization').toString(),
  name: 'hypequery',
  url: absoluteUrl('/').toString(),
  logo: absoluteUrl('/logo.png').toString(),
  sameAs: [
    'https://github.com/hypequery/hypequery',
    'https://www.npmjs.com/package/@hypequery/clickhouse',
    'https://twitter.com/hypequery',
    'https://www.newsletter.hypequery.com',
  ],
};

const websiteSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': absoluteUrl('/#website').toString(),
  name: 'hypequery',
  url: absoluteUrl('/').toString(),
  publisher: { '@id': absoluteUrl('/#organization').toString() },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema) }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(() => {
  try {
    const key = ${JSON.stringify(THEME_STORAGE_KEY)};
    const stored = window.localStorage.getItem(key);
    const mode = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
    const resolved = mode === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : mode;
    const root = document.documentElement;
    // Set class attribute for fumadocs compatibility
    root.classList.remove('light', 'dark');
    root.classList.add(resolved);
    // Also set data-theme for custom styling
    root.setAttribute('data-theme', resolved);
    root.style.colorScheme = resolved;
  } catch (_) {}
})();`,
          }}
        />
        {/*
          Umami is cookieless and collects no personal data, so it is
          consent-exempt and loads unconditionally. GA and Leadfeeder set
          cookies or identify visitors — they are gated behind the consent
          banner (see CookieConsentBanner) and injected only after opt-in.
        */}
        <Script
          defer
          src="https://cloud.umami.is/script.js"
          data-website-id="a1b133a2-bf0a-4260-9c2c-f76a2a20359f"
          strategy="afterInteractive"
        />
      </head>
      <body
        className={`${sans.variable} ${mono.variable} ${displayFont.variable} antialiased`}
      >
        <RootProvider
          theme={{
            defaultTheme: "system",
            enableSystem: true,
            disableTransitionOnChange: true,
            storageKey: THEME_STORAGE_KEY,
            attribute: ["class", "data-theme"],
          }}
          search={{
            SearchDialog: DefaultSearchDialog,
          }}
        >
          {children}
        </RootProvider>
        <CookieConsentBanner gaMeasurementId={gaMeasurementId} />
      </body>
    </html>
  );
}
