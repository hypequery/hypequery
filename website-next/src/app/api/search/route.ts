import { createSearchAPI } from 'fumadocs-core/search/server';
import { source } from '@/lib/meta';

export const { GET } = createSearchAPI('advanced', {
  indexes: source.getPages().map((page) => ({
    title: page.data.title,
    structuredData: page.data.structuredData,
    id: page.url,
    url: page.url,
  })),
});
