import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "hypequery Serve + Next.js",
  description: "Demo dashboard powered by @hypequery/serve",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
