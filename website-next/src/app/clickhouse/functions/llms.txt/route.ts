import { functionEntries, subIndex } from '@/lib/llms-index';

export const revalidate = false;

export function GET() {
  return subIndex(
    'ClickHouse function pages',
    'One page per ClickHouse function: signature, what it does, example SQL, and the typed hypequery equivalent.',
    functionEntries(),
    'No function pages yet.',
  );
}
