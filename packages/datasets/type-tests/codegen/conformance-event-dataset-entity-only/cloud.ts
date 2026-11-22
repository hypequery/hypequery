// Round-trip fixture for @hypequery/datasets/codegen. Regenerate with `vitest -u`.

import { publishToCloud } from '../../../src/index.js';
import { datasets } from './datasets.js';

export const cloud = publishToCloud({ datasets, access: { roles: [], scopes: [] } });
