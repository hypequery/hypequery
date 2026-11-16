import { exampleEntries, subIndex } from '@/lib/llms-index';

export const revalidate = false;

export function GET() {
  return subIndex(
    'examples',
    'Runnable ClickHouse examples, each a small app over one seeded dataset and run in CI. Scaffold any of them with `npx @hypequery/cli create <slug> -y`. Each link is the Markdown twin of the page.',
    exampleEntries(),
    'No examples published yet.',
  );
}
