import type { Metadata } from "next";
import Script from "next/script";
import { Plus_Jakarta_Sans, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { RootProvider } from "fumadocs-ui/provider/next";
import DefaultSearchDialog from "@/components/search";
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
    default: "hypequery | Type-Safe Analytics Backend for ClickHouse",
    template: "%s | hypequery",
  },
  description: "Define ClickHouse metrics once in TypeScript, then reuse them across APIs, jobs, dashboards, and AI agents.",
  alternates: {
    canonical: absoluteUrl('/'),
  },
  openGraph: {
    type: 'website',
    url: absoluteUrl('/'),
    title: 'hypequery | Type-Safe Analytics Backend for ClickHouse',
    description: 'Define ClickHouse metrics once in TypeScript, then reuse them across APIs, jobs, dashboards, and AI agents.',
    siteName: 'hypequery',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'hypequery | Type-Safe Analytics Backend for ClickHouse',
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
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
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: '',
          }}
        />
        <Script
          defer
          src="https://cloud.umami.is/script.js"
          data-website-id="a1b133a2-bf0a-4260-9c2c-f76a2a20359f"
          strategy="afterInteractive"
        />
        <Script
          id="leadfeeder"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `(function (ss, ex) {
  window.ldfdr =
    window.ldfdr ||
    function () {
      (ldfdr._q = ldfdr._q || []).push([].slice.call(arguments));
    };
  (function (d, s) {
    fs = d.getElementsByTagName(s)[0];
    function ce(src) {
      var cs = d.createElement(s);
      cs.src = src;
      cs.async = 1;
      fs.parentNode.insertBefore(cs, fs);
    }
    ce(
      "https://sc.lfeeder.com/lftracker_v1_" +
        ss +
        (ex ? "_" + ex : "") +
        ".js"
    );
  })(document, "script");
})("DzLR5a5lx1Z4BoQ2");`,
          }}
        />
        {gaMeasurementId ? (
          <>
            <Script
              async
              src={`https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}`}
              strategy="afterInteractive"
            />
            <Script
              id="ga"
              strategy="afterInteractive"
              dangerouslySetInnerHTML={{
                __html: `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${gaMeasurementId}');`,
              }}
            />
          </>
        ) : null}
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
            attribute: "class",
          }}
          search={{
            SearchDialog: DefaultSearchDialog,
          }}
        >
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
