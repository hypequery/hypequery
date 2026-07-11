import { ImageResponse } from 'next/og';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'hypequery — The TypeScript analytics layer for ClickHouse';

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 72,
          background: 'linear-gradient(135deg, #101223 0%, #1c2145 55%, #3a3f8c 100%)',
          color: '#ffffff',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: '#a5b4fc',
            }}
          />
          <div style={{ fontSize: 36, fontWeight: 700 }}>hypequery</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.1, maxWidth: 1000 }}>
            The TypeScript analytics layer for ClickHouse
          </div>
          <div style={{ fontSize: 30, color: '#c7d2fe', maxWidth: 960 }}>
            Define metrics once. Reuse them across APIs, jobs, dashboards, and AI agents.
          </div>
        </div>
        <div style={{ display: 'flex', fontSize: 26, color: '#a5b4fc' }}>hypequery.com</div>
      </div>
    ),
    size,
  );
}
