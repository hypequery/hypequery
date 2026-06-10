import Footer from '@/components/Footer';
import Navigation from '@/components/Navigation';
import {
  AnnouncementBanner,
  Hero,
  DefineOnce,
  Capabilities,
  Stack,
  UseCases,
  FinalCTA,
} from '@/components/home';

export default function Home() {
  return (
    <div className="min-h-screen bg-bg text-text">
      <AnnouncementBanner />
      <Navigation />
      <main className="pt-[98px]">
        <Hero />
        <DefineOnce />
        <Capabilities />
        <Stack />
        <UseCases />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
