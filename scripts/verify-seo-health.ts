#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const websiteRoot = path.join(repoRoot, 'website-next');
const canonicalOrigin = normalizeOrigin(
  process.env.SEO_CANONICAL_ORIGIN ?? 'https://hypequery.com',
);
const aliasOrigin = normalizeOrigin(
  process.env.SEO_ALIAS_ORIGIN ?? 'https://www.hypequery.com',
);
const fetchOrigin = normalizeOrigin(
  process.env.SEO_FETCH_ORIGIN ?? canonicalOrigin,
);
const concurrency = positiveInteger(process.env.SEO_CONCURRENCY, 10);
const timeoutMs = positiveInteger(process.env.SEO_TIMEOUT_MS, 15_000);
const skipAliasRedirect = process.env.SEO_SKIP_ALIAS_REDIRECT === '1';

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeOrigin(value) {
  const url = new URL(value);
  return url.origin;
}

function normalizePageUrl(value) {
  const url = new URL(value);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  return `${url.origin}${pathname}`;
}

function decodeEntities(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

function parseSitemapLocations(xml) {
  return Array.from(xml.matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi), (match) =>
    decodeEntities(match[1].trim()),
  );
}

function parseAttributes(tag) {
  const attributes = new Map();
  const pattern = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of tag.matchAll(pattern)) {
    attributes.set(
      match[1].toLowerCase(),
      decodeEntities(match[2] ?? match[3] ?? match[4] ?? ''),
    );
  }
  return attributes;
}

function extractCanonical(html) {
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0]);
    const rel = attributes.get('rel')?.toLowerCase().split(/\s+/) ?? [];
    if (rel.includes('canonical')) {
      return attributes.get('href') ?? null;
    }
  }
  return null;
}

function frontmatterValue(source, field) {
  if (!source.startsWith('---')) return null;
  const end = source.indexOf('\n---', 3);
  if (end === -1) return null;
  const frontmatter = source.slice(3, end);
  const match = frontmatter.match(new RegExp(`^${field}:\\s*["']?([^\\n"']+)["']?\\s*$`, 'm'));
  return match?.[1]?.trim() ?? null;
}

function sanitizeSlug(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function functionPathSegment(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replaceAll('_', '-')
    .toLowerCase();
}

function discoverMarkdownRoutes(root, routePrefix) {
  const routes = new Set();

  function visit(directory, segments) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath, [...segments, entry.name]);
        continue;
      }

      if (!entry.name.endsWith('.md') && !entry.name.endsWith('.mdx')) continue;
      const basename = entry.name.replace(/\.(?:md|mdx)$/, '');
      const routeSegments = basename === 'index' ? segments : [...segments, basename];
      routes.add(
        routeSegments.length > 0
          ? `${routePrefix}/${routeSegments.join('/')}`
          : routePrefix,
      );
    }
  }

  visit(root, []);
  return routes;
}

function discoverCompareRoutes() {
  const source = fs.readFileSync(
    path.join(websiteRoot, 'src/data/compare-pages.ts'),
    'utf8',
  );
  return new Set(
    Array.from(source.matchAll(/href:\s*['"](\/compare\/[^'"]+)['"]/g), (match) => match[1]),
  );
}

function discoverBlogRoutes(compareRoutes) {
  const blogRoot = path.join(websiteRoot, 'content/blog');
  const redirectedSlugs = new Set(
    Array.from(compareRoutes, (route) => route.slice('/compare/'.length)),
  );
  const routes = new Set();

  for (const filename of fs.readdirSync(blogRoot)) {
    if (!filename.endsWith('.md') && !filename.endsWith('.mdx')) continue;
    const source = fs.readFileSync(path.join(blogRoot, filename), 'utf8');
    const status = frontmatterValue(source, 'status') ?? 'published';
    if (status !== 'published') continue;

    const filenameSlug = filename
      .replace(/^\d{4}-\d{2}-\d{2}-/, '')
      .replace(/\.(?:md|mdx)$/, '');
    const slug = sanitizeSlug(frontmatterValue(source, 'slug') ?? filenameSlug);
    if (!redirectedSlugs.has(slug)) routes.add(`/blog/${slug}`);
  }

  return routes;
}

function discoverClickHouseRoutes() {
  const appRoot = path.join(websiteRoot, 'src/app');
  const routes = new Set();

  for (const entry of fs.readdirSync(appRoot, { withFileTypes: true })) {
    if (
      entry.isDirectory() &&
      entry.name.startsWith('clickhouse-') &&
      fs.existsSync(path.join(appRoot, entry.name, 'page.tsx'))
    ) {
      routes.add(`/${entry.name}`);
    }
  }

  if (fs.existsSync(path.join(appRoot, 'clickhouse/functions/page.tsx'))) {
    routes.add('/clickhouse/functions');
  }

  return routes;
}

function discoverClickHouseFunctionRoutes() {
  const source = fs.readFileSync(
    path.join(websiteRoot, 'src/data/clickhouse-functions.ts'),
    'utf8',
  );
  const functionNames = Array.from(
    source.matchAll(/^    (?:"name"|name):\s*["']([^"']+)["'],?\s*$/gm),
    (match) => match[1],
  );

  if (functionNames.length === 0) {
    throw new Error('No ClickHouse function routes were discovered from clickhouse-functions.ts');
  }

  return new Set(
    functionNames.map(
      (name) => `/clickhouse/functions/${functionPathSegment(name)}`,
    ),
  );
}

function extractLinks(html, baseUrl) {
  const links = [];
  for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
    const href = parseAttributes(match[0]).get('href');
    if (!href) continue;

    try {
      links.push(new URL(href, baseUrl));
    } catch {
      // Ignore malformed and non-URL href values.
    }
  }
  return links;
}

async function discoverLiveBlogRoutes() {
  const routes = new Set();
  const pendingPages = ['/blog'];
  const visitedPages = new Set();
  const allowedOrigins = new Set([fetchOrigin, canonicalOrigin, aliasOrigin]);

  while (pendingPages.length > 0) {
    const page = pendingPages.shift();
    if (!page || visitedPages.has(page)) continue;
    if (visitedPages.size >= 100) {
      throw new Error('Blog route discovery exceeded 100 index pages');
    }
    visitedPages.add(page);

    const pageUrl = new URL(page, fetchOrigin).toString();
    const response = await request(pageUrl, { redirect: 'manual' });
    if (response.status !== 200) {
      throw new Error(`${pageUrl} returned ${response.status} during blog route discovery`);
    }

    for (const link of extractLinks(await response.text(), pageUrl)) {
      if (!allowedOrigins.has(link.origin)) continue;

      const pathname = link.pathname.replace(/\/+$/, '') || '/';
      if (/^\/blog\/[^/]+$/.test(pathname)) {
        routes.add(pathname);
        continue;
      }

      if (pathname !== '/blog') continue;
      const pageNumber = Number.parseInt(link.searchParams.get('page') ?? '', 10);
      if (Number.isInteger(pageNumber) && pageNumber > 1) {
        const paginationRoute = `/blog?page=${pageNumber}`;
        if (!visitedPages.has(paginationRoute)) pendingPages.push(paginationRoute);
      }
    }
  }

  return routes;
}

async function discoverExpectedRoutes() {
  const compareRoutes = discoverCompareRoutes();
  return new Set([
    ...compareRoutes,
    ...discoverBlogRoutes(compareRoutes),
    ...(await discoverLiveBlogRoutes()),
    ...discoverClickHouseRoutes(),
    ...discoverClickHouseFunctionRoutes(),
    ...discoverMarkdownRoutes(path.join(websiteRoot, 'docs'), '/docs'),
  ]);
}

function localFetchUrl(canonicalUrl) {
  const url = new URL(canonicalUrl);
  return new URL(`${url.pathname}${url.search}`, fetchOrigin).toString();
}

async function request(url, init = {}) {
  return fetch(url, {
    ...init,
    headers: {
      'user-agent': 'hypequery-seo-health/1.0',
      ...init.headers,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function mapConcurrent(items, worker) {
  let cursor = 0;
  const results = new Array(items.length);
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index], index);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

async function verifyAliasRedirect() {
  if (skipAliasRedirect) return;

  const response = await request(aliasOrigin, { redirect: 'manual' });
  if (response.status !== 301 && response.status !== 308) {
    throw new Error(
      `${aliasOrigin} must return 301/308 to ${canonicalOrigin}; received ${response.status}`,
    );
  }

  const location = response.headers.get('location');
  if (!location) {
    throw new Error(`${aliasOrigin} redirect did not include a Location header`);
  }

  const destination = normalizePageUrl(new URL(location, aliasOrigin).toString());
  if (destination !== normalizePageUrl(canonicalOrigin)) {
    throw new Error(
      `${aliasOrigin} redirects to ${destination}, expected ${normalizePageUrl(canonicalOrigin)}`,
    );
  }
}

async function main() {
  const sitemapResponse = await request(
    new URL('/sitemap.xml', fetchOrigin).toString(),
    { redirect: 'manual' },
  );
  if (sitemapResponse.status !== 200) {
    throw new Error(`sitemap.xml returned ${sitemapResponse.status}`);
  }

  const sitemapUrls = parseSitemapLocations(await sitemapResponse.text());
  if (sitemapUrls.length === 0) {
    throw new Error('sitemap.xml contained no <loc> entries');
  }

  const normalizedSitemapUrls = sitemapUrls.map(normalizePageUrl);
  const duplicateUrls = normalizedSitemapUrls.filter(
    (url, index) => normalizedSitemapUrls.indexOf(url) !== index,
  );
  if (duplicateUrls.length > 0) {
    throw new Error(
      `sitemap.xml contains duplicate URLs:\n${[...new Set(duplicateUrls)].join('\n')}`,
    );
  }

  const wrongOrigin = sitemapUrls.filter(
    (url) => new URL(url).origin !== canonicalOrigin,
  );
  if (wrongOrigin.length > 0) {
    throw new Error(
      `sitemap.xml contains URLs outside ${canonicalOrigin}:\n${wrongOrigin.join('\n')}`,
    );
  }

  const sitemapSet = new Set(normalizedSitemapUrls);
  const expectedRoutes = await discoverExpectedRoutes();
  const missingRoutes = Array.from(expectedRoutes)
    .map((route) => normalizePageUrl(new URL(route, canonicalOrigin).toString()))
    .filter((url) => !sitemapSet.has(url))
    .sort();
  if (missingRoutes.length > 0) {
    throw new Error(
      `Important routes are missing from sitemap.xml:\n${missingRoutes.join('\n')}`,
    );
  }

  await verifyAliasRedirect();

  const pageErrors = (
    await mapConcurrent(sitemapUrls, async (canonicalUrl) => {
      try {
        const response = await request(localFetchUrl(canonicalUrl), {
          redirect: 'manual',
        });
        if (response.status !== 200) {
          return `${canonicalUrl}: returned ${response.status}, expected 200`;
        }

        const canonical = extractCanonical(await response.text());
        if (!canonical) {
          return `${canonicalUrl}: missing <link rel="canonical">`;
        }

        const resolvedCanonical = normalizePageUrl(
          new URL(canonical, canonicalUrl).toString(),
        );
        const expectedCanonical = normalizePageUrl(canonicalUrl);
        if (resolvedCanonical !== expectedCanonical) {
          return `${canonicalUrl}: canonical is ${resolvedCanonical}`;
        }
        return null;
      } catch (error) {
        return `${canonicalUrl}: ${error instanceof Error ? error.message : String(error)}`;
      }
    })
  ).filter(Boolean);

  if (pageErrors.length > 0) {
    throw new Error(
      `${pageErrors.length} sitemap page(s) failed status/canonical checks:\n${pageErrors.join('\n')}`,
    );
  }

  console.log(
    `SEO health check passed: ${sitemapUrls.length} sitemap URLs, ${expectedRoutes.size} important routes, and ${aliasOrigin} redirects to ${canonicalOrigin}.`,
  );
}

main().catch((error) => {
  console.error(`SEO health check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
