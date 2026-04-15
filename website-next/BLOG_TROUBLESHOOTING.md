# Blog Route Testing & Troubleshooting Guide

This guide helps you test and debug blog route issues in production.

## Quick Test

Run the test script to verify your configuration:

```bash
node test-blog.js
```

## Testing Blog Routes

### 1. Local Development Testing

Start your development server:

```bash
cd website-next
npm run dev
```

Then visit these URLs:
- **Blog Index**: http://localhost:3000/blog
- **Individual Post**: http://localhost:3000/blog/turn-your-clickhouse-schema-into-a-type-safe-analytics-layer-in-5-minutes

### 2. Production Build Testing

Build and test locally:

```bash
cd website-next
npm run build
npm start
```

Visit the same URLs as above to verify production build works.

### 3. Testing Specific Blog Slugs

Based on your content/blog directory, you can test these slugs:

1. `turn-your-clickhouse-schema-into-a-type-safe-analytics-layer-in-5-minutes`
2. `a-guide-to-materialized-views-in-clickhouse`
3. `type-safe-schema-management-clickhouse`
4. `the-analytics-language-layer-why-real-time-data-needs-typed-apis-not-just-faster-databases`
5. `seven-companies-one-pattern-why-every-scaled-clickhouse-deployment-looks-the-same`
6. `type-safe-sql-in-typescript-why-your-current-approach-is-failing-you-and-what-to-do-about-it`
7. `building-dashboards-clickhouse-hypequery-nextjs`

## Common Production Issues

### Issue 1: "Cannot create data directory in production"

**Error:**
```
Error: ENOENT: no such file or directory, mkdir '/var/task/website-next/data'
```

**Cause:**
The blog CMS is trying to create a local SQLite database in production, which fails because:
1. The file system is read-only in serverless environments
2. The `BLOB_READ_WRITE_TOKEN` environment variable is not set

**Solution:**
Set the `BLOB_READ_WRITE_TOKEN` environment variable in your Vercel project:

1. Go to your Vercel project dashboard
2. Navigate to Settings → Environment Variables
3. Add `BLOB_READ_WRITE_TOKEN` (this is automatically set by Vercel Blob Storage)
4. Or, if you're not using Vercel Blob, you need to set up a different durable storage solution

**Temporary Fix for Testing:**
If you just want to test with seed posts (from content/blog), the code now falls back to seed posts when blob storage fails.

### Issue 2: "Blog CMS requires BLOB_READ_WRITE_TOKEN"

**Cause:**
You're running in production mode without blob storage configured.

**Solution:**
Same as Issue 1 - configure Vercel Blob Storage or another durable storage solution.

## Environment Configuration

### Local Development
- **Storage Mode**: Local SQLite (automatically created in `data/blog-cms.sqlite`)
- **Environment**: No special configuration needed
- **Data Source**: Seed posts from `content/blog/` + any CMS posts

### Production (Vercel)
- **Storage Mode**: Vercel Blob (requires `BLOB_READ_WRITE_TOKEN`)
- **Environment**: `BLOB_READ_WRITE_TOKEN` must be set
- **Data Source**: Posts stored in Vercel Blob
- **Fallback**: If blob storage fails, falls back to seed posts

## Debug Mode

To enable debug logging, check your server logs:

```bash
# Local development
npm run dev

# Look for console.log messages from blog-cms.ts
```

Key debug messages:
- `Failed to read from blob storage, falling back to seed posts` - Blob storage issue
- `Blog CMS requires BLOB_READ_WRITE_TOKEN` - Missing environment variable

## Manual Testing Checklist

Use this checklist to verify blog functionality:

- [ ] Blog index page loads at `/blog`
- [ ] Individual blog posts load at `/blog/[slug]`
- [ ] Blog posts display correct title, description, and date
- [ ] Markdown content renders correctly
- [ ] Code blocks are properly highlighted
- [ ] Pagination works (if you have >10 posts)
- [ ] Navigation "Back to Blog" works
- [ ] No console errors in browser
- [ ] Server logs show no errors

## Performance Testing

Test with production build:

```bash
cd website-next
npm run build
npm start
```

Check:
- Page load time is acceptable (<2 seconds)
- No memory leaks
- Static generation works correctly

## Deployment Verification

After deploying to Vercel:

1. Check deployment logs for any errors
2. Visit your production blog URL
3. Test all the checklist items above
4. Monitor Vercel Analytics for performance issues

## Adding New Blog Posts

Create a new markdown file in `content/blog/`:

```bash
# Format: YYYY-MM-DY-your-post-slug.md
touch content/blog/2024-01-15-my-new-post.md
```

Add frontmatter:

```markdown
---
title: My New Post
description: This is my new blog post
date: 2024-01-15
status: published
author: Your Name
tags: ["clickhouse", "analytics"]
seoTitle: SEO Title Here
seoDescription: SEO description here
---

# Your Content Here

This is the blog post content in Markdown format.
```

## Getting Help

If you're still having issues:

1. Run `node test-blog.js` and share the output
2. Check server logs for specific error messages
3. Verify environment variables are set correctly
4. Check that all dependencies are installed: `npm install`
5. Try clearing Next.js cache: `rm -rf .next && npm run build`

## Recent Fixes

The following fixes have been applied to resolve production issues:

1. **Enhanced Error Handling**: Better error messages when blob storage is not configured
2. **Production Environment Detection**: Prevents trying to create SQLite database in production
3. **Graceful Fallback**: Falls back to seed posts if blob storage fails
4. **Clear Error Messages**: Specific instructions for missing environment variables
