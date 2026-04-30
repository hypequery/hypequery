import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import matter from 'gray-matter';
import { get, put } from '@vercel/blob';
import { unstable_noStore as noStore } from 'next/cache';

export type BlogStatus = 'draft' | 'review' | 'published';
export type CmsStorageMode = 'blob' | 'local-json';

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

type BlogStoreFile = {
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
const localStorePath = path.join(dataDir, 'blog-posts.local.json');
const seedBlogDir = path.join(process.cwd(), 'content/blog');
const blobPathname = 'cms/blog-posts.json';

function hasBlobStorage() {
  return typeof process.env.BLOB_READ_WRITE_TOKEN === 'string' && process.env.BLOB_READ_WRITE_TOKEN.length > 0;
}

export function getCmsStorageMode(): CmsStorageMode {
  return hasBlobStorage() ? 'blob' : 'local-json';
}

export function getCmsStorageLabel() {
  return getCmsStorageMode() === 'blob' ? 'Vercel Blob' : 'Local JSON fallback';
}

export function isCmsDurableStorageConfigured() {
  return getCmsStorageMode() === 'blob';
}

function isValidDate(date: Date) {
  return !Number.isNaN(date.getTime());
}

function normalizeDate(value: unknown) {
  if (value instanceof Date) {
    return isValidDate(value) ? value.toISOString() : null;
  }

  if (typeof value === 'number') {
    const date = new Date(value);
    return isValidDate(date) ? date.toISOString() : null;
  }

  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }

  const date = new Date(value);
  return isValidDate(date) ? date.toISOString() : null;
}

function sanitizeSlug(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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
      status: normalizeStatus(data.status ?? 'published'),
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

function normalizeStoredPost(post: Partial<BlogPostRecord>): BlogPostRecord | null {
  const slug = typeof post.slug === 'string' ? sanitizeSlug(post.slug) : '';
  if (!slug) {
    return null;
  }

  return {
    id: typeof post.id === 'string' ? post.id : crypto.randomUUID(),
    slug,
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
  };
}

function mergeSeedPosts(existingPosts: BlogPostRecord[], seedPosts: BlogPostRecord[]) {
  const merged = new Map<string, BlogPostRecord>();

  for (const post of existingPosts) {
    merged.set(post.slug, post);
  }

  for (const seedPost of seedPosts) {
    const existing = merged.get(seedPost.slug);

    if (!existing || existing.source === 'seed') {
      merged.set(seedPost.slug, existing ? {
        ...seedPost,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: seedPost.updatedAt,
      } : seedPost);
    }
  }

  return sortPosts(Array.from(merged.values()));
}

function ensureLocalDataDir() {
  fs.mkdirSync(dataDir, { recursive: true });
}

function readLocalStoreRaw(): BlogPostRecord[] {
  if (!fs.existsSync(localStorePath)) {
    return [];
  }

  const text = fs.readFileSync(localStorePath, 'utf-8');
  const parsed = JSON.parse(text) as Partial<BlogStoreFile>;
  const posts = Array.isArray(parsed.posts) ? parsed.posts : [];

  return posts
    .map((post) => normalizeStoredPost(post))
    .filter((post): post is BlogPostRecord => post !== null);
}

function writeLocalStore(posts: BlogPostRecord[]) {
  ensureLocalDataDir();
  const payload: BlogStoreFile = { version: 1, posts };
  fs.writeFileSync(localStorePath, JSON.stringify(payload, null, 2), 'utf-8');
}

function readLocalStore(): BlogPostRecord[] {
  const mergedPosts = mergeSeedPosts(readLocalStoreRaw(), createSeedPosts());
  writeLocalStore(mergedPosts);
  return mergedPosts;
}

async function readBlobStore(): Promise<BlogPostRecord[]> {
  let result;

  try {
    result = await get(blobPathname, {
      access: 'private',
      useCache: false,
    });
  } catch (error) {
    throw new Error('Failed to read blog posts from Vercel Blob.', {
      cause: error,
    });
  }

  if (!result) {
    const seededPosts = createSeedPosts();
    await writeBlobStore(seededPosts);
    return seededPosts;
  }

  if (result.statusCode !== 200) {
    throw new Error(`Unexpected Vercel Blob response while reading blog posts: ${result.statusCode}.`);
  }

  const text = await new Response(result.stream).text();
  let parsed: Partial<BlogStoreFile>;

  try {
    parsed = JSON.parse(text) as Partial<BlogStoreFile>;
  } catch (error) {
    throw new Error('Failed to parse blog posts from Vercel Blob.', {
      cause: error,
    });
  }

  const posts = Array.isArray(parsed.posts) ? parsed.posts : [];

  return posts
    .map((post) => normalizeStoredPost(post))
    .filter((post): post is BlogPostRecord => post !== null);
}

async function writeBlobStore(posts: BlogPostRecord[]) {
  const payload: BlogStoreFile = {
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
    try {
      return sortPosts(await readBlobStore());
    } catch (error) {
      console.error('Failed to read from blob storage, falling back to seed posts:', error);
      return sortPosts(createSeedPosts());
    }
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Blog CMS requires BLOB_READ_WRITE_TOKEN environment variable to be set in production.');
  }

  return readLocalStore();
}

async function saveAllPostsInternal(posts: BlogPostRecord[]) {
  const sortedPosts = sortPosts(posts);

  if (hasBlobStorage()) {
    await writeBlobStore(sortedPosts);
    return;
  }

  writeLocalStore(sortedPosts);
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
  const posts = await getAllPostsInternal();

  return posts
    .filter((post) => post.status === 'published')
    .sort((a, b) => new Date(b.publishedAt ?? b.updatedAt).getTime() - new Date(a.publishedAt ?? a.updatedAt).getTime())
    .map(formatPostForPublic);
}

export async function getPostBySlug(slug: string): Promise<BlogPost | null> {
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

  await saveAllPostsInternal(nextPosts);
  return nextPost;
}
