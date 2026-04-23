import SiteFooter from '@/components/SiteFooter';
import SiteHeader from '@/components/SiteHeader';
import Script from 'next/script';

export default function BlogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <SiteHeader />
      <main className="min-h-screen">{children}</main>
      <SiteFooter />
      <Script
        src="https://subscribe-forms.beehiiv.com/embed.js"
        strategy="afterInteractive"
      />
    </>
  );
}
