import { recipeEntries, subIndex } from '@/lib/llms-index';

export const revalidate = false;

export function GET() {
  return subIndex(
    'recipes',
    'One ClickHouse question per recipe: the hypequery dataset definition, the SQL it generates, and the output on the seed dataset. Each link is the Markdown twin of the page.',
    recipeEntries(),
    'No recipes published yet.',
  );
}
