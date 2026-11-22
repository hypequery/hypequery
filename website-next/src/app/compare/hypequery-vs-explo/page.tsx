import { ComparisonPageView, comparisonMetadata } from '@/components/comparison-page';
import { exploComparison as page } from '@/data/comparisons/explo';
import { updatedFor } from '@/data/page-dates';

export const metadata = comparisonMetadata(page);

export default function Page() {
  return <ComparisonPageView page={page} updated={updatedFor(page.path)} />;
}
