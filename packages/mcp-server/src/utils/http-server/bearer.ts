/** Bearer credential helpers shared by the HTTP transport's authenticators. */

/** The Bearer token in an `Authorization` header, or undefined when none is presented. */
export function bearerToken(header: string | null): string | undefined {
  if (header === null) return undefined;
  const match = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(header);
  return match ? match[1] : undefined;
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

/**
 * Compare two secrets without leaking where they differ. Both sides are hashed
 * first, so the comparison runs over equal-length values whatever was sent.
 */
export async function secretsEqual(presented: string, expected: string): Promise<boolean> {
  const [left, right] = await Promise.all([digest(presented), digest(expected)]);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}
