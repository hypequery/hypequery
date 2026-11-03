// Loads the site's brand fonts (Space Grotesk, JetBrains Mono) as TTF for next/og.
// Satori cannot read woff2, and the default OG font only ships a regular weight.

type OgFont = {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 500 | 700;
  style: 'normal';
};

const FONTS = [
  { name: 'Space Grotesk', family: 'Space+Grotesk', weight: 700 },
  { name: 'Space Grotesk', family: 'Space+Grotesk', weight: 500 },
  { name: 'JetBrains Mono', family: 'JetBrains+Mono', weight: 700 },
] as const;

async function loadGoogleFont(family: string, weight: number): Promise<ArrayBuffer> {
  // Without a modern browser user agent Google Fonts serves TrueType URLs.
  const css = await fetch(`https://fonts.googleapis.com/css2?family=${family}:wght@${weight}`).then((res) =>
    res.text(),
  );
  const url = css.match(/src: url\((.+?)\) format\('(?:truetype|opentype)'\)/)?.[1];
  if (!url) {
    throw new Error(`No TTF source for ${family} ${weight}`);
  }
  return fetch(url).then((res) => res.arrayBuffer());
}

let cached: Promise<OgFont[]> | undefined;

export function loadOgFonts(): Promise<OgFont[]> {
  cached ??= Promise.all(
    FONTS.map(async ({ name, family, weight }) => ({
      name,
      data: await loadGoogleFont(family, weight),
      weight,
      style: 'normal' as const,
    })),
  ).catch((error) => {
    // Fall back to the built-in font rather than failing the image.
    console.error('[og] font load failed', error);
    cached = undefined;
    return [];
  });
  return cached;
}
