import Footer from '@/components/Footer';
import Navigation from '@/components/Navigation';
import {
  AnnouncementBanner,
  Hero,
  Quickstart,
  DefineOnce,
  Capabilities,
  Stack,
  UseCases,
  Cloud,
  FinalCTA,
} from '@/components/home';

export default function Home() {
  return (
    <div className="min-h-screen bg-bg text-text">
      <AnnouncementBanner />
      <Navigation />
      <main className="pt-[98px]">
        <Hero />
        <Quickstart />
        <DefineOnce />
        <Capabilities />
        <Stack />
        <UseCases />
        <Cloud />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
