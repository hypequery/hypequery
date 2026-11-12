// Round-trip fixture for @hypequery/datasets/codegen. Regenerate with `vitest -u`.

import { dataset } from '../../../src/index.js';

export const UsersDataset = dataset('users', { source: 'users', rowResolution: { kind: 'final' }, dimensions: {} });

/** The datasets published with an endpoint. */
export const datasets = {
  users: UsersDataset,
};
