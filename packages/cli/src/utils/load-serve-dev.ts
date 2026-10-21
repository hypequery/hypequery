/**
 * `@hypequery/serve` is an optional peer: projects that only generate clients
 * (a React app, for example) should not have server packages installed for them.
 */
export async function loadServeDev(
  load: () => Promise<typeof import('@hypequery/serve/dev')> = () => import('@hypequery/serve/dev'),
): Promise<typeof import('@hypequery/serve/dev')> {
  try {
    return await load();
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    const message = error instanceof Error ? error.message : '';
    // Only serve itself: a module serve fails to find is a different problem.
    if ((code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') && message.includes("'@hypequery/serve")) {
      throw new Error('hypequery dev needs @hypequery/serve. Install it: npm install @hypequery/serve');
    }
    throw error;
  }
}
