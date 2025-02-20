import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Layout } from "@/components/layout/layout";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "HypeQuery Dashboard",
  description: "Example dashboard built with HypeQuery",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="h-full">
      <body className={`${inter.className} h-full`}>
        <Layout>{children}</Layout>
      </body>
    </html>
  );
}
