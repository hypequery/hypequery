import { readFileSync } from 'node:fs';
import { validateProtocolClientContract } from '@hypequery/protocol';
import { describe, expect, it } from 'vitest';
import { clientQueryFieldHint, clientQueryTargetHint } from './query-hint.js';

const success = JSON.parse(readFileSync(new URL('../../../../../specs/security-protocol/fixtures/client-contract-v1/success.json', import.meta.url), 'utf8')) as { id: string; value: unknown }[];
const contract = validateProtocolClientContract(success.find(item => item.id === 'build')!.value);

// Kept identical to python/hypequery/tests/test_mcp_query_hints.py.
const expected: [string, string, string][] = [
  ["target", "query_dataset", " Datasets: \"countries\", \"orders\"."],
  ["target", "query_metric", " Metrics: \"ordersRevenue\" on \"orders\"."],
  ["orders", "/dimensions/0", " Offered by \"orders\": \"amount\", \"country\", \"customer.tier\"."],
  ["orders", "/measures/2", " Offered by \"orders\": \"averageRevenue\", \"customer.unique\", \"latestLabel\", \"orderCount\", \"revenue\"."],
  ["orders", "/filters/0/field", " Offered by \"orders\": \"amount\", \"country\", \"customer.active\", \"customer.tier\", \"paidStatus\"."],
  ["orders", "/orderBy/0/field", " A selected field \"orders\" can order by, once each: \"amount\", \"country\", \"customer.tier\", \"averageRevenue\", \"customer.unique\", \"latestLabel\", \"orderCount\", \"revenue\", \"period\" (with a grain)."],
  ["orders", "/having/0/measure", " A selected measure \"orders\" allows in having: \"averageRevenue\", \"customer.unique\", \"orderCount\", \"revenue\"."],
  ["orders", "/having/0/field", ""],
  ["orders", "/filters/0/value", ""],
  ["countries", "/measures/0", " \"countries\" offers none."],
  ["countries", "/having/0/measure", " \"countries\" offers none."],
];

describe('client query hints', () => {
  it.each(expected)('%s %s', (target, argument, hint) => {
    if (target === 'target') expect(clientQueryTargetHint(contract, argument)).toBe(hint);
    else expect(clientQueryFieldHint(contract.endpoints.find(endpoint => endpoint.id === target)!, argument)).toBe(hint);
  });
});
