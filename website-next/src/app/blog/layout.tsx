import Footer from '@/components/Footer';
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
      <main className="min-h-screen bg-bg pt-28 text-text">{children}</main>
      <Footer />
      <Script
        src="https://subscribe-forms.beehiiv.com/embed.js"
        strategy="afterInteractive"
      />
    </>
  );
}
