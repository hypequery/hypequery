const SITE_URL = 'https://hypequery.com';

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
