import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import matter from 'gray-matter';
import { get, put } from '@vercel/blob';
import { unstable_noStore as noStore } from 'next/cache';
import { DatabaseSync } from 'node:sqlite';

export type BlogStatus = 'draft' | 'review' | 'published';
export type CmsStorageMode = 'blob' | 'local-sqlite';

export interface BlogPostRecord {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  body: string;
  status: BlogStatus;
  author: string | null;
  tags: string[];
  seoTitle: string | null;
  seoDescription: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  source: 'seed' | 'cms';
}

export interface BlogPost {
  slug: string;
  data: {
    title: string;
    description?: string;
    date?: string;
    author?: string;
    tags?: string[];
    seoTitle?: string;
    seoDescription?: string;
    status: BlogStatus;
  };
  content: string;
}

export interface UpsertBlogPostInput {
  id?: string;
  slug: string;
  title: string;
  description?: string;
  body: string;
  status: BlogStatus;
  author?: string;
  tags?: string[];
  seoTitle?: string;
  seoDescription?: string;
  publishedAt?: string;
}

type BlogPostRow = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  body: string;
  status: BlogStatus;
  author: string | null;
  tags_json: string | null;
  seo_title: string | null;
  seo_description: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  source: 'seed' | 'cms';
};

type BlobStoreFile = {
  version: 1;
  posts: BlogPostRecord[];
};

function normalizeStatus(value: unknown): BlogStatus {
  if (value === 'published' || value === 'review') {
    return value;
  }

  return 'draft';
}

function normalizeSource(value: unknown): BlogPostRecord['source'] {
  return value === 'seed' ? 'seed' : 'cms';
}

const dataDir = path.join(process.cwd(), 'data');
const dbPath = path.join(dataDir, 'blog-cms.sqlite');
const seedBlogDir = path.join(process.cwd(), 'content/blog');
const blobPathname = 'cms/blog-posts.json';

let database: DatabaseSync | null = null;

function hasBlobStorage() {
  return typeof process.env.BLOB_READ_WRITE_TOKEN === 'string' && process.env.BLOB_READ_WRITE_TOKEN.length > 0;
}

export function getCmsStorageMode(): CmsStorageMode {
  return hasBlobStorage() ? 'blob' : 'local-sqlite';
}

export function getCmsStorageLabel() {
  return getCmsStorageMode() === 'blob' ? 'Vercel Blob' : 'Local SQLite fallback';
}

export function isCmsDurableStorageConfigured() {
  return getCmsStorageMode() === 'blob';
}

function createSeedPosts(): BlogPostRecord[] {
  if (!fs.existsSync(seedBlogDir)) {
    return [];
  }

  const files = fs
    .readdirSync(seedBlogDir)
    .filter((file) => file.endsWith('.md') || file.endsWith('.mdx'));

  return files.map((filename) => {
    const filePath = path.join(seedBlogDir, filename);
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const { data, content } = matter(fileContent);
    const now = new Date().toISOString();

    return {
      id: crypto.randomUUID(),
      slug: getSlugFromFilename(filename, data.slug),
      title: typeof data.title === 'string' ? data.title : getSlugFromFilename(filename, data.slug),
      description: typeof data.description === 'string' ? data.description : null,
      body: content,
      status: 'published',
      author: typeof data.author === 'string' ? data.author : null,
      tags: Array.isArray(data.tags) ? data.tags.filter((item): item is string => typeof item === 'string') : [],
      seoTitle: typeof data.seoTitle === 'string' ? data.seoTitle : null,
      seoDescription: typeof data.seoDescription === 'string' ? data.seoDescription : null,
      publishedAt: normalizeDate(data.date ?? data.pubDate) ?? now,
      createdAt: now,
      updatedAt: now,
      source: 'seed',
    };
  });
}

function getSlugFromFilename(filename: string, explicitSlug?: unknown) {
  if (typeof explicitSlug === 'string' && explicitSlug.length > 0) {
    return sanitizeSlug(explicitSlug);
  }

  return sanitizeSlug(
    filename
      .replace(/^\d{4}-\d{2}-\d{2}-/, '')
      .replace(/\.(md|mdx)$/, ''),
  );
}

function sanitizeSlug(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeDate(value: unknown) {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function sortPosts(posts: BlogPostRecord[]) {
  return [...posts].sort((a, b) => {
    const statusWeight = (status: BlogStatus) => {
      switch (status) {
        case 'published':
          return 0;
        case 'review':
          return 1;
        default:
          return 2;
      }
    };

    const weight = statusWeight(a.status) - statusWeight(b.status);
    if (weight !== 0) {
      return weight;
    }

    const aDate = new Date(a.publishedAt ?? a.updatedAt).getTime();
    const bDate = new Date(b.publishedAt ?? b.updatedAt).getTime();
    return bDate - aDate;
  });
}

function mapRow(row: BlogPostRow): BlogPostRecord {
  const tags = row.tags_json ? safeParseStringArray(row.tags_json) : [];

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    body: row.body,
    status: row.status,
    author: row.author,
    tags,
    seoTitle: row.seo_title,
    seoDescription: row.seo_description,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    source: row.source,
  };
}

function safeParseStringArray(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function getDatabase() {
  if (!database) {
    fs.mkdirSync(dataDir, { recursive: true });
    database = new DatabaseSync(dbPath);
    initializeDatabase(database);
  }

  return database;
}

function initializeDatabase(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS blog_posts (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      body TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('draft', 'review', 'published')),
      author TEXT,
      tags_json TEXT,
      seo_title TEXT,
      seo_description TEXT,
      published_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'cms' CHECK(source IN ('seed', 'cms'))
    );

    CREATE INDEX IF NOT EXISTS blog_posts_status_idx
      ON blog_posts(status, published_at DESC, updated_at DESC);
  `);

  const insert = db.prepare(`
    INSERT OR IGNORE INTO blog_posts (
      id,
      slug,
      title,
      description,
      body,
      status,
      author,
      tags_json,
      seo_title,
      seo_description,
      published_at,
      created_at,
      updated_at,
      source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const post of createSeedPosts()) {
    insert.run(
      post.id,
      post.slug,
      post.title,
      post.description,
      post.body,
      post.status,
      post.author,
      JSON.stringify(post.tags),
      post.seoTitle,
      post.seoDescription,
      post.publishedAt,
      post.createdAt,
      post.updatedAt,
      post.source,
    );
  }
}

async function readBlobStore(): Promise<BlogPostRecord[]> {
  const result = await get(blobPathname, {
    access: 'private',
    useCache: false,
  });

  if (!result) {
    const seededPosts = createSeedPosts();
    await writeBlobStore(seededPosts);
    return seededPosts;
  }

  if (result.statusCode !== 200) {
    return [];
  }

  const text = await new Response(result.stream).text();
  const parsed = JSON.parse(text) as Partial<BlobStoreFile>;
  const posts = Array.isArray(parsed.posts) ? parsed.posts : [];

  return posts.map((post) => ({
    id: typeof post.id === 'string' ? post.id : crypto.randomUUID(),
    slug: typeof post.slug === 'string' ? sanitizeSlug(post.slug) : '',
    title: typeof post.title === 'string' ? post.title : 'Untitled post',
    description: typeof post.description === 'string' ? post.description : null,
    body: typeof post.body === 'string' ? post.body : '',
    status: normalizeStatus(post.status),
    author: typeof post.author === 'string' ? post.author : null,
    tags: Array.isArray(post.tags) ? post.tags.filter((item): item is string => typeof item === 'string') : [],
    seoTitle: typeof post.seoTitle === 'string' ? post.seoTitle : null,
    seoDescription: typeof post.seoDescription === 'string' ? post.seoDescription : null,
    publishedAt: normalizeDate(post.publishedAt) ?? null,
    createdAt: normalizeDate(post.createdAt) ?? new Date().toISOString(),
    updatedAt: normalizeDate(post.updatedAt) ?? new Date().toISOString(),
    source: normalizeSource(post.source),
  })).filter((post) => post.slug.length > 0);
}

async function writeBlobStore(posts: BlogPostRecord[]) {
  const payload: BlobStoreFile = {
    version: 1,
    posts,
  };

  await put(blobPathname, JSON.stringify(payload, null, 2), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 60,
  });
}

async function getAllPostsInternal(): Promise<BlogPostRecord[]> {
  if (hasBlobStorage()) {
    return sortPosts(await readBlobStore());
  }

  const db = getDatabase();
  const rows = db.prepare(`
    SELECT *
    FROM blog_posts
    ORDER BY
      CASE status
        WHEN 'published' THEN 0
        WHEN 'review' THEN 1
        ELSE 2
      END,
      COALESCE(published_at, updated_at) DESC
  `).all<BlogPostRow>();

  return rows.map(mapRow);
}

async function saveAllPostsInternal(posts: BlogPostRecord[]) {
  if (hasBlobStorage()) {
    await writeBlobStore(posts);
    return;
  }

  const db = getDatabase();
  db.exec('BEGIN');

  try {
    const remove = db.prepare('DELETE FROM blog_posts');
    remove.run();

    const insert = db.prepare(`
      INSERT INTO blog_posts (
        id,
        slug,
        title,
        description,
        body,
        status,
        author,
        tags_json,
        seo_title,
        seo_description,
        published_at,
        created_at,
        updated_at,
        source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const post of posts) {
      insert.run(
        post.id,
        post.slug,
        post.title,
        post.description,
        post.body,
        post.status,
        post.author,
        JSON.stringify(post.tags),
        post.seoTitle,
        post.seoDescription,
        post.publishedAt,
        post.createdAt,
        post.updatedAt,
        post.source,
      );
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function validateInput(input: UpsertBlogPostInput) {
  const slug = sanitizeSlug(input.slug);
  if (!slug) {
    throw new Error('Slug is required.');
  }

  if (!input.title.trim()) {
    throw new Error('Title is required.');
  }

  if (!input.body.trim()) {
    throw new Error('Body is required.');
  }

  return slug;
}

export function formatPostForPublic(post: BlogPostRecord): BlogPost {
  return {
    slug: post.slug,
    data: {
      title: post.title,
      description: post.description ?? undefined,
      date: post.publishedAt ?? undefined,
      author: post.author ?? undefined,
      tags: post.tags,
      seoTitle: post.seoTitle ?? undefined,
      seoDescription: post.seoDescription ?? undefined,
      status: post.status,
    },
    content: post.body,
  };
}

export async function getPosts(): Promise<BlogPost[]> {
  noStore();
  const posts = await getAllPostsInternal();

  return posts
    .filter((post) => post.status === 'published')
    .sort((a, b) => new Date(b.publishedAt ?? b.updatedAt).getTime() - new Date(a.publishedAt ?? a.updatedAt).getTime())
    .map(formatPostForPublic);
}

export async function getPostBySlug(slug: string): Promise<BlogPost | null> {
  noStore();
  const posts = await getAllPostsInternal();
  const post = posts.find((item) => item.slug === sanitizeSlug(slug) && item.status === 'published');

  return post ? formatPostForPublic(post) : null;
}

export async function getAdminPosts(): Promise<BlogPostRecord[]> {
  noStore();
  return getAllPostsInternal();
}

export async function getAdminPostById(id: string): Promise<BlogPostRecord | null> {
  noStore();
  const posts = await getAllPostsInternal();
  return posts.find((post) => post.id === id) ?? null;
}

export async function upsertBlogPost(input: UpsertBlogPostInput): Promise<BlogPostRecord> {
  const now = new Date().toISOString();
  const slug = validateInput(input);
  const posts = await getAllPostsInternal();

  const existingBySlug = posts.find((post) => post.slug === slug);
  if (existingBySlug && existingBySlug.id !== input.id) {
    throw new Error('A post with this slug already exists.');
  }

  const publishedAt = input.status === 'published'
    ? normalizeDate(input.publishedAt) ?? now
    : normalizeDate(input.publishedAt);

  const tags = (input.tags ?? []).map((tag) => tag.trim()).filter(Boolean);

  const nextPost: BlogPostRecord = input.id
    ? {
      ...(posts.find((post) => post.id === input.id) ?? {
        id: input.id,
        createdAt: now,
        source: 'cms' as const,
      }),
      id: input.id,
      slug,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      body: input.body,
      status: input.status,
      author: input.author?.trim() || null,
      tags,
      seoTitle: input.seoTitle?.trim() || null,
      seoDescription: input.seoDescription?.trim() || null,
      publishedAt,
      updatedAt: now,
      source: 'cms',
    }
    : {
      id: crypto.randomUUID(),
      slug,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      body: input.body,
      status: input.status,
      author: input.author?.trim() || null,
      tags,
      seoTitle: input.seoTitle?.trim() || null,
      seoDescription: input.seoDescription?.trim() || null,
      publishedAt,
      createdAt: now,
      updatedAt: now,
      source: 'cms',
    };

  const nextPosts = posts.some((post) => post.id === nextPost.id)
    ? posts.map((post) => (post.id === nextPost.id ? nextPost : post))
    : [...posts, nextPost];

  await saveAllPostsInternal(sortPosts(nextPosts));
  return nextPost;
}
