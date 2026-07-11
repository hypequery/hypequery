const SITE_URL = 'https://www.hypequery.com';

function normalizePath(pathname: string) {
  if (!pathname || pathname === '/') {
    return '/';
  }

  const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

export const siteUrl = new URL(SITE_URL);

export function absoluteUrl(pathname: string) {
  return new URL(normalizePath(pathname), siteUrl);
}

export function ogImage(title?: string) {
  const url = new URL('/og', siteUrl);
  if (title) {
    url.searchParams.set('title', title);
  }

  return [
    {
      url: url.toString(),
      width: 1200,
      height: 630,
      alt: title ?? 'hypequery — The TypeScript analytics layer for ClickHouse',
    },
  ];
}
