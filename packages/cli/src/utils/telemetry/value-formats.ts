/** Format rules are shared by validation, snapshots and generated documentation. */
export const VALUE_FORMATS = {
  uuid: { pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, maxLength: 36, description: 'Random UUID v4 (36 characters)' },
  hash: { pattern: /^[0-9a-f]{64}$/, maxLength: 64, description: '64 lowercase hexadecimal characters (salted SHA-256)' },
  version: { pattern: /^(?:unknown|\d{1,3}\.\d{1,3}\.\d{1,3}(?:-(?:canary|alpha|beta|rc|dev|snapshot)(?:[.-]\d{1,14})*)?)$/, maxLength: 80, description: 'Exact major.minor.patch (1–3 digits per component); optional canary/alpha/beta/rc/dev/snapshot suffix with 1–14 digit numeric components, or `unknown`; at most 80 characters' },
  node_version: { pattern: /^(?:unknown|\d{1,3}\.\d{1,3})$/, maxLength: 80, description: 'Numeric major.minor (1–3 digits per component), or `unknown`' },
  major_version: { pattern: /^(?:unknown|\d{1,3})$/, maxLength: 80, description: 'Numeric major (1–3 digits), or `unknown`' },
} as const;

export function matchesTelemetryFormat(format: keyof typeof VALUE_FORMATS, value: unknown): boolean {
  const rule = VALUE_FORMATS[format];
  return typeof value === 'string' && value.length <= rule.maxLength
    && rule.pattern.exec(value)?.[0] === value;
}
