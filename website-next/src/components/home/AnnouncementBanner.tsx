export function AnnouncementBanner() {
  return (
    <div className="fixed top-0 left-0 right-0 z-[60] bg-gradient-to-r from-accent via-[#5b61d6] to-accent text-white py-2.5 border-b-2 border-white/20 shadow-lg">
      <div className="px-4 text-center text-[13px] font-medium">
        🚀 Datasets are here — model your ClickHouse data once, in TypeScript. Read the launch post →
      </div>
    </div>
  );
}
