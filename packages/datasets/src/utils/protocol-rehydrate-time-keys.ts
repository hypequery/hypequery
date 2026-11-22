/** Contract 3 `alternateTimeFields` as the rehydrated dataset's `timeKeys` (RFC 0029). */
export function alternateTimeKeys(contract: object): { timeKeys?: string[] } {
  const alternates = (contract as { alternateTimeFields?: readonly unknown[] }).alternateTimeFields;
  return alternates?.length ? { timeKeys: alternates.map(String) } : {};
}
