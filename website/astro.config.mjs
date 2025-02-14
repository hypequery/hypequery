// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import mdx from '@astrojs/mdx';

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
        wrap: true,
        transformers: [{
          code(node) {
            // Add the necessary classes for the copy button functionality
            const wrapper = {
              type: 'element',
              tagName: 'div',
              properties: { className: ['relative'] },
              children: [
                node,
                {
                  type: 'element',
                  tagName: 'button',
                  properties: {
                    className: [
                      'copy-button',
                      'absolute',
                      'right-0',
                      'top-0',
                      'rounded-md',
                      'text-gray-400',
                      'opacity-0',
                      'transition-opacity',
                      'hover:text-gray-200',
                      'group-hover:opacity-100',
                      'bg-black/30',
                      'border',
                      'border-white/10'
                    ],
                    'aria-label': 'Copy code',
                    onclick: `
                      const code = this.parentElement.querySelector('code').textContent;
                      navigator.clipboard.writeText(code).then(() => {
                        this.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
                        setTimeout(() => {
                          this.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
                        }, 2000);
                      });
                    `
                  },
                  children: [{
                    type: 'element',
                    tagName: 'svg',
                    properties: {
                      xmlns: 'http://www.w3.org/2000/svg',
                      width: '20',
                      height: '20',
                      viewBox: '0 0 24 24',
                      fill: 'none',
                      stroke: 'currentColor',
                      'stroke-width': '2',
                      'stroke-linecap': 'round',
                      'stroke-linejoin': 'round'
                    },
                    children: [
                      {
                        type: 'element',
                        tagName: 'rect',
                        properties: {
                          width: '14',
                          height: '14',
                          x: '8',
                          y: '8',
                          rx: '2',
                          ry: '2'
                        }
                      },
                      {
                        type: 'element',
                        tagName: 'path',
                        properties: {
                          d: 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'
                        }
                      }
                    ]
                  }]
                }
              ]
            };
            return wrapper;
          }
        }]
      }
    })
  ],
  site: 'https://hypequery.dev',
  compressHTML: true
});
