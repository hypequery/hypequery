import { ImageResponse } from 'next/og';
import { getPostBySlug } from '@/lib/blog';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'hypequery blog post';

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  const title = post?.data.title ?? 'hypequery blog';
  const fontSize = title.length > 70 ? 48 : 60;

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
        <div
          style={{
            display: 'flex',
            fontSize,
            fontWeight: 700,
            lineHeight: 1.15,
            maxWidth: 1020,
          }}
        >
          {title}
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 26,
            color: '#a5b4fc',
          }}
        >
          <div>Blog</div>
          <div>hypequery.com</div>
        </div>
      </div>
    ),
    size,
  );
}
