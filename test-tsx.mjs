import { pathToFileURL } from 'node:url';
import path from 'node:path';

const resolved = path.resolve(process.cwd(), 'examples/next-dashboard/src/analytics/queries.ts');
const moduleUrl = `${pathToFileURL(resolved).href}?t=${Date.now()}`;

try {
  const tsx = await import('tsx/esm/api');
  console.log('tsx loaded, calling register()');
  const unregister = tsx.register();
  console.log('tsx registered, importing module');

  const mod = await import(moduleUrl);

  console.log('Module imported successfully');
  console.log('Module exports:', Object.keys(mod));

  unregister();
} catch (error) {
  console.error('Error:', error.message);
  console.error('Stack:', error.stack);
}
