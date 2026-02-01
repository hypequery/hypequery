import Navigation from '@/components/Navigation';
import Script from 'next/script';

export default function BlogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Navigation />
      <main className="min-h-screen">{children}</main>
      <Script
        src="https://subscribe-forms.beehiiv.com/embed.js"
        strategy="afterInteractive"
      />
    </>
  );
}
