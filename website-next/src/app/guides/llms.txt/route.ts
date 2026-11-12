import { guideEntries, subIndex } from '@/lib/llms-index';

export const revalidate = false;

export function GET() {
  return subIndex(
    'guides',
    'Long-form ClickHouse guides with SQL that is run against the seed dataset in CI. Each link is the Markdown twin of the page.',
    guideEntries(),
    'No guides published yet.',
  );
}
