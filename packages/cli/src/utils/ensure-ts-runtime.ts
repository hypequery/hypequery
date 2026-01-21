let tsxRuntimePromise: Promise<unknown> | null = null;
const defaultImporter = () => import('tsx/esm');
let runtimeImporter: () => Promise<unknown> = defaultImporter;

export async function ensureTypeScriptRuntime() {
  if (!tsxRuntimePromise) {
    tsxRuntimePromise = runtimeImporter().catch(error => {
      tsxRuntimePromise = null;
      throw error;
    });
  }

  await tsxRuntimePromise;
}

export function setTypeScriptRuntimeImporter(importer: () => Promise<unknown>) {
  runtimeImporter = importer;
  tsxRuntimePromise = null;
}

export function resetTypeScriptRuntimeForTesting() {
  runtimeImporter = defaultImporter;
  tsxRuntimePromise = null;
}
