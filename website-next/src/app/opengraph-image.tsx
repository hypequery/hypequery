import { OG_SIZE, renderBrandImage } from '@/lib/og/brand-card';

export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = 'hypequery — The analytics layer for ClickHouse';

export default function Image() {
  return renderBrandImage({
    title: 'The analytics layer for ClickHouse',
    eyebrow: 'TypeScript · Python · Open source',
  });
}
