import { exploComparison } from '@/data/comparisons/explo';
import { querypanelComparison } from '@/data/comparisons/querypanel';
import type { ComparisonPage } from '@/data/comparisons/types';

/** Every page rendered by ComparisonPageView. The /compare hub, sitemap and llms.txt read this list. */
export const comparisonPages: ComparisonPage[] = [querypanelComparison, exploComparison];
