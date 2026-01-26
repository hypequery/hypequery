declare module 'esbuild' {
  interface BuildOptions {
    entryPoints: string[];
    bundle: boolean;
    format: 'esm' | 'cjs';
    platform: 'node' | 'browser';
    target?: string[] | string;
    sourcemap?: 'inline' | boolean;
    write?: boolean;
    logLevel?: 'silent' | 'info' | 'error' | 'warning' | 'debug' | 'verbose';
    absWorkingDir?: string;
    packages?: 'external' | 'inline';
    tsconfig?: string;
    loader?: Record<string, 'ts' | 'tsx' | 'js' | 'jsx' | 'json' | 'text'>;
  }

  interface BuildOutputFile {
    path: string;
    text: string;
  }

  interface BuildResult {
    outputFiles?: BuildOutputFile[];
  }

  export function build(options: BuildOptions): Promise<BuildResult>;
}
