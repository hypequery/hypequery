import { createSearchAPI } from 'fumadocs-core/search/server';
import { source } from '@/lib/meta';

export const { GET } = createSearchAPI('simple', {
  indexes: async () =>
    Promise.all(
      source.getPages().map(async (page) => ({
        title: page.data.title,
        description: page.data.description,
        breadcrumbs: page.slugs,
        content: await page.data.getText('processed'),
        url: page.url,
        keywords: page.slugs.join(' '),
      }))
    ),
});
