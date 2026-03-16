const DEFAULT_SITE_URL = 'https://hypequery.com';

function normalizeSiteUrl(value?: string | null) {
  if (!value) {
    return DEFAULT_SITE_URL;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_SITE_URL;
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

export function getSiteUrl() {
  return new URL(
    normalizeSiteUrl(
      process.env.NEXT_PUBLIC_SITE_URL ??
        process.env.SITE_URL ??
        process.env.VERCEL_PROJECT_PRODUCTION_URL,
    ),
  );
}

export function getCanonicalUrl(pathname: string) {
  return new URL(pathname, getSiteUrl());
}

export const siteConfig = {
  name: 'hypequery',
  title: 'hypequery | Type-Safe Analytics Backend for ClickHouse',
  description:
    'Define ClickHouse metrics once in TypeScript, then reuse them across APIs, jobs, dashboards, and AI agents.',
};
