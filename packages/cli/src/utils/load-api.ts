import { pathToFileURL } from 'node:url';
import path from 'node:path';

const API_EXPORT_ERROR = (modulePath: string) =>
  `Module at ${modulePath} does not export a serve API. Export your defineServe result as 'api'.`;

export async function loadApiModule(modulePath: string) {
  const resolved = path.resolve(process.cwd(), modulePath);
  const moduleUrl = `${pathToFileURL(resolved).href}?t=${Date.now()}`;

  if (resolved.endsWith('.ts')) {
    try {
      const tsx = await import('tsx/esm/api');
      const unregister = tsx.register();
      const mod = await import(moduleUrl);
      unregister();
      const api = mod.api ?? mod.default;

      if (!api || typeof api.handler !== 'function') {
        throw new Error(API_EXPORT_ERROR(modulePath));
      }

      return api;
    } catch (error: any) {
      if (error?.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes('tsx')) {
        throw new Error(
          `To run TypeScript files directly, install tsx:\n  npm install -D tsx\n\nOr compile your TypeScript first:\n  tsc ${modulePath}`
        );
      }
      throw error;
    }
  }

  const mod = await import(moduleUrl);
  const api = mod.api ?? mod.default;

  if (!api || typeof api.handler !== 'function') {
    throw new Error(API_EXPORT_ERROR(modulePath));
  }

  return api;
}
