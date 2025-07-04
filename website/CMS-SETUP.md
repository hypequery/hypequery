# Decap CMS Setup Guide

This guide explains how to set up and use Decap CMS (formerly Netlify CMS) for managing blog content on the hypequery website, following the official Astro integration.

## Overview

The CMS is configured using the official Astro + Decap CMS integration:
- **Admin Route**: `/admin` (served by Astro)
- **Configuration**: `public/admin/config.yml`
- **Content**: `src/content/blog/`

## Quick Start

### Development Setup

1. **Start the Astro dev server:**
   ```bash
   cd website
   npm run dev
   ```

2. **Visit the CMS:**
   ```
   http://localhost:4321/admin
   ```

### Production Setup

1. **Visit the production CMS:**
   ```
   https://hypequery.com/admin
   ```

## Configuration Files

### CMS Config (`public/admin/config.yml`)
- Defines blog collection structure
- Configures media uploads
- Sets up field types and validation

### Admin Route (`src/pages/admin.html`)
- Serves the Decap CMS React app
- Loads configuration from `/admin/config.yml`
- Handles authentication

## Content Structure

### Blog Posts
- **Location**: `src/content/blog/`
- **Format**: Markdown with frontmatter
- **Fields**:
  - `layout`: Hidden field (default: "blog")
  - `title`: Post title
  - `description`: Post description (optional)
  - `pubDate`: Publication date
  - `heroImage`: Hero image (optional)
  - `body`: Main content (markdown)

### File Naming
Posts are automatically named using the pattern:
```
{{year}}-{{month}}-{{day}}-{{slug}}.md
```

## Authentication

### Netlify Identity
- Integrated with Netlify Identity widget
- Users must be invited through Netlify dashboard
- Supports role-based access

### Setup Steps
1. Enable Netlify Identity in your Netlify dashboard
2. Configure Git Gateway
3. Invite users to the CMS

## Development Workflow

1. **Start development server:**
   ```bash
   npm run dev
   ```

2. **Create/edit content:**
   - Visit `http://localhost:4321/admin`
   - Make changes in the CMS interface
   - Changes are saved to local files

3. **Test changes:**
   - Content updates automatically
   - View changes at `http://localhost:4321/blog`

## Production Workflow

1. **Access production CMS:**
   - Visit `https://hypequery.com/admin`
   - Login with Netlify Identity

2. **Create/edit content:**
   - Make changes in the CMS interface
   - Changes are committed to Git automatically
   - Netlify rebuilds the site

## Troubleshooting

### Common Issues

#### CMS Not Loading
- **Cause**: Configuration file not found
- **Solution**: Ensure `public/admin/config.yml` exists

#### Authentication Issues
- **Cause**: Netlify Identity not configured
- **Solution**: Enable Identity in Netlify dashboard

#### Content Not Updating
- **Cause**: Build cache or configuration issues
- **Solution**: Check Netlify build logs and CMS configuration

### Development Commands

```bash
# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## File Structure

```
website/
├── public/
│   └── admin/
│       └── config.yml          # CMS configuration
├── src/
│   ├── pages/
│   │   └── admin.html          # Admin route
│   └── content/
│       └── blog/               # Blog content
└── package.json
```

## Security Notes

- CMS is protected by Netlify Identity
- Git Gateway provides secure Git access
- Content is version controlled
- Admin route is publicly accessible but requires authentication

## Important Notes

- **No Local Backend**: This setup doesn't require decap-server
- **Astro Integration**: Uses official Astro + Decap CMS integration
- **Static Generation**: Works with Astro's static site generation
- **Media Uploads**: Files are stored in `public/images/uploads`

## Next Steps

1. **Set up Netlify Identity** in your Netlify dashboard
2. **Configure Git Gateway** for production
3. **Invite team members** to the CMS
4. **Test the workflow** in development first
5. **Deploy and test** production CMS 