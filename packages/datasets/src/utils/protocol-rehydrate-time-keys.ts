import { datasetTimeAxes, type ProtocolAnyVersionDataset } from '@hypequery/protocol';

/** Contract 3 `alternateTimeFields` as the rehydrated dataset's `timeKeys` (RFC 0029). */
export function alternateTimeKeys(contract: ProtocolAnyVersionDataset): { timeKeys?: string[] } {
  // The default axis comes first; the rest are the alternates in authored order.
  const alternates = datasetTimeAxes(contract).slice(1);
  return alternates.length > 0 ? { timeKeys: alternates.map(String) } : {};
}
