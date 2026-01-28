declare const process: {
  env: Record<string, string | undefined>;
  exit(code?: number): never;
};
