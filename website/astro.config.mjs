// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import mdx from '@astrojs/mdx';
import netlify from '@astrojs/netlify';
import partytown from '@astrojs/partytown';

// https://astro.build/config
export default defineConfig({
  integrations: [
    tailwind({
      // Disable the default base styles
      applyBaseStyles: false,
    }),
    mdx({
      remarkPlugins: [],
      rehypePlugins: [],
      // Configure syntax highlighting
      syntaxHighlight: 'shiki',
      shikiConfig: {
        wrap: true
        // Disabled transformers to avoid TypeScript errors
      }
    }),
    partytown({
      config: {
        forward: ["dataLayer.push"],
      },
    }),
  ],
  site: 'https://hypequery.com',
  compressHTML: true,
  // Add the Netlify adapter for server-side rendering support
  adapter: netlify(),
  // Use static output for development
  output: 'static',
  // Ensure assets in the public directory are preserved during build
  build: {
    // Preserve the structure of the public directory
    assets: 'assets',
    // Preserve all files in public directory
    assetsPrefix: '/'
  }
});
