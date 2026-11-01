/**
 * A response body, refused once it passes `maxBytes`: by the declared length
 * before reading, and while streaming when no length is declared.
 */
export async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const tooLarge = () => new Error(`The response exceeds ${maxBytes} bytes.`);
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    // Release the connection rather than leave the body unread.
    await response.body?.cancel();
    throw tooLarge();
  }
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
