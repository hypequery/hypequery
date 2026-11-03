// Shared social preview card (Open Graph / X) rendered with next/og.
// White background, mascot logo mark, dark text — matches the light site theme.

import { ImageResponse } from 'next/og';
import { loadOgFonts } from './fonts';

export const OG_SIZE = { width: 1200, height: 630 };

const INK = '#252b3a';
const MUTED = '#5a5d63';

function LogoMark({ size }: { size: number }) {
  // Static version of /mascot/hypequery-logo-compact-blink.svg. Satori does not
  // support SVG masks, so the eyes are painted white over the body instead.
  return (
    <svg width={size} height={(size * 36) / 32} viewBox="0 0 32 36">
      <path
        fill={INK}
        d="M5 17H11V13A3 3 0 0 1 14 10H21V6A3 3 0 0 1 24 3H27A3 3 0 0 1 30 6V30A3 3 0 0 1 27 33H5A3 3 0 0 1 2 30V20A3 3 0 0 1 5 17Z"
      />
      <rect x="14" y="20.5" width="3.5" height="5" rx="1.75" fill="#ffffff" />
      <rect x="23" y="20.5" width="3.5" height="5" rx="1.75" fill="#ffffff" />
    </svg>
  );
}

export function BrandCard({ title, eyebrow }: { title: string; eyebrow?: string }) {
  const fontSize = title.length > 55 ? 54 : title.length > 36 ? 64 : 72;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '80px 88px',
        background: '#ffffff',
        color: INK,
        fontFamily: 'Space Grotesk, sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <LogoMark size={52} />
        <div style={{ fontSize: 40, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', letterSpacing: -1 }}>
          hypequery
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          fontSize,
          fontWeight: 700,
          lineHeight: 1.12,
          letterSpacing: -1.5,
          maxWidth: 1024,
          textWrap: 'balance',
        }}
      >
        {title}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 28,
          fontWeight: 500,
          color: MUTED,
        }}
      >
        <div>{eyebrow ?? ''}</div>
        <div>hypequery.com</div>
      </div>
    </div>
  );
}

export async function renderBrandImage(props: { title: string; eyebrow?: string }) {
  return new ImageResponse(<BrandCard {...props} />, { ...OG_SIZE, fonts: await loadOgFonts() });
}
