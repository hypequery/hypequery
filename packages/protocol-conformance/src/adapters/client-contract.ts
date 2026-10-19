import {
  decodeProtocolClientContract, prepareProtocolClientContract,
  validateProtocolClientContract, validateProtocolClientQuery,
} from '@hypequery/protocol';
import type { FixtureRole, HandlerResult } from '../types.js';
import { clientContractTargets } from './utils/client-contract-targets.js';
type Data = Record<string, unknown>;
export function handleClientContract(role: FixtureRole, c: Data): HandlerResult {
  if (c.mode === 'decode') { decodeProtocolClientContract(c.value as string); return { ok: true }; }
  if (c.mode === 'query') {
    const value = c.value as Data;
    const result = validateProtocolClientQuery(value.contract, value.endpoint as string, value.input, value.transport as 'http' | 'mcp');
    return { ok: true, output: { body: result.body, selectedMeasures: result.selectedMeasures, effectiveLimit: result.effectiveLimit } };
  }
  if (c.mode === 'relation') {
    const value = c.value as Data;
    if (value.contract) return { ok: true, output: clientContractTargets(validateProtocolClientContract(value.contract)) };
    const left = validateProtocolClientContract(value.left), right = validateProtocolClientContract(value.right);
    return { ok: true, output: {
      sameEndpointSchemas: left.endpoints.filter(e => right.endpoints.some(r => r.id === e.id && r.schemaHash === e.schemaHash)).map(e => e.id),
      sameContentHash: left.contentHash === right.contentHash,
    } };
  }
  const contract = validateProtocolClientContract(c.value);
  if (role !== 'identity') return { ok: true };
  const { contentHash: _hash, endpoints, ...root } = contract;
  const prepared = prepareProtocolClientContract({ ...root, endpoints: endpoints.map(({ schemaHash: _schemaHash, ...endpoint }) => endpoint) });
  return { ok: true, output: { canonical: prepared.canonical, sha256: prepared.contentHash } };
}
