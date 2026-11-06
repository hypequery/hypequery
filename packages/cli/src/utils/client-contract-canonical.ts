import { prepareProtocolClientContract, validateProtocolClientContract } from '@hypequery/protocol';

/**
 * Re-sign an API's exported client contract and return its canonical text.
 * The export is project code, so its identities are checked rather than
 * trusted, as Python's `export client-contract` does.
 */
export function canonicalClientContract(exported: unknown): string {
  const wrapper = typeof exported === 'object' && exported !== null && 'contract' in exported
    ? exported as { contract: unknown; canonical?: unknown; contentHash?: unknown }
    : undefined;
  const contract = validateProtocolClientContract(wrapper ? wrapper.contract : exported);
  // Drop the identities so they are recomputed, never copied.
  const unsigned = (value: object, identity: string) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== identity));
  const prepared = prepareProtocolClientContract({
    ...unsigned(contract, 'contentHash'),
    endpoints: contract.endpoints.map(endpoint => unsigned(endpoint, 'schemaHash')),
  });
  if (wrapper && (wrapper.canonical !== prepared.canonical || wrapper.contentHash !== prepared.contentHash)) {
    throw new Error('The exported client contract identities do not match its validated contract.');
  }
  return prepared.canonical;
}
