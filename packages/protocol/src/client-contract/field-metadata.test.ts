import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CLIENT_CONTRACT_FEATURES,
  CLIENT_CONTRACT_FEATURES_HEADER,
  acceptsClientFieldMetadata,
  parseClientContractFeatures,
} from './features.js';
import { withoutClientFieldMetadata } from './field-metadata.js';
import { validateProtocolClientContract } from './validate.js';
import type { PreparedProtocolClientContract, ProtocolClientContract } from './types.js';
import { clientCanonical } from './safe-data.js';

const directory = new URL('../../../../specs/security-protocol/fixtures/client-contract-v1/', import.meta.url);
const success = JSON.parse(readFileSync(new URL('success.json', directory), 'utf8')) as Array<{ id: string; value: unknown }>;
const contract = (id: string): ProtocolClientContract => validateProtocolClientContract(success.find(item => item.id === id)!.value);
const prepared = (value: ProtocolClientContract): PreparedProtocolClientContract => (
  { contract: value, canonical: clientCanonical(value), contentHash: value.contentHash }
);

describe('client contract features header', () => {
  it('names the features this version validates', () => {
    expect(CLIENT_CONTRACT_FEATURES_HEADER).toBe('x-hypequery-client-features');
    expect(acceptsClientFieldMetadata(CLIENT_CONTRACT_FEATURES)).toBe(true);
  });

  it('reads comma-separated, case-insensitive tokens and ignores unknown ones', () => {
    expect(acceptsClientFieldMetadata(' future-thing , Field-Metadata ')).toBe(true);
    expect([...parseClientContractFeatures('a,,b ,')]).toEqual(['a', 'b']);
    expect(acceptsClientFieldMetadata('field-metadatas')).toBe(false);
  });

  it('names no features for an absent or oversized header', () => {
    expect(acceptsClientFieldMetadata(undefined)).toBe(false);
    expect(acceptsClientFieldMetadata(null)).toBe(false);
    expect(acceptsClientFieldMetadata('field-metadata,' + 'x'.repeat(256))).toBe(false);
  });
});

describe('withoutClientFieldMetadata', () => {
  it('reduces field metadata to the annotated view an older consumer accepts', () => {
    const result = withoutClientFieldMetadata(prepared(contract('field-metadata')));
    const annotated = contract('annotated');
    expect(result.contract).toEqual(annotated);
    expect(result.contentHash).toBe(annotated.contentHash);
    expect(result.canonical).toBe(clientCanonical(annotated));
  });

  it('keeps contracts without field metadata unchanged and preserves the view', () => {
    for (const id of ['build', 'annotated', 'metric-only', 'narrowed']) {
      const value = contract(id);
      expect(withoutClientFieldMetadata(prepared(value)).contentHash).toBe(value.contentHash);
    }
    expect(withoutClientFieldMetadata(prepared(contract('narrowed'))).contract.view).toBe(contract('narrowed').view);
  });
});
