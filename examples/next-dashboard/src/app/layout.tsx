import type { Metadata } from "next";
import "./globals.css";
import { Layout } from "@/components/layout/layout";
import { QueryProvider } from "@/components/providers/query-provider";
import { FiltersProvider } from "@/lib/filters-context";

export const metadata: Metadata = {
  title: "hypequery Dashboard",
  description: "Example dashboard built with hypequery",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full font-sans">
        <QueryProvider>
          <FiltersProvider>
            <Layout>{children}</Layout>
          </FiltersProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
