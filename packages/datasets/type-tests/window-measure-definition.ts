import { createWindowMeasure } from '../src/utils/window-measure-definition.js';

createWindowMeasure('revenue', { trailing: { amount: 7, unit: 'day' } });
createWindowMeasure('revenue', { toDate: 'month' });
createWindowMeasure('revenue', { cumulative: true });

// @ts-expect-error A factory input must declare exactly one window mode.
createWindowMeasure('revenue', {});
// @ts-expect-error Combining modes is invalid before a definition is created.
createWindowMeasure('revenue', { cumulative: true, toDate: 'month' });
// @ts-expect-error Cumulative mode must be true.
createWindowMeasure('revenue', { cumulative: false });
