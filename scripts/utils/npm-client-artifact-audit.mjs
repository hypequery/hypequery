/** Every file a package declares as an entrypoint: main, types, bin and export targets. */
export function declaredEntrypoints(metadata) {
  const targets = new Set(['package.json']);
  const collect = value => {
    if (typeof value === 'string') { if (!value.includes('*')) targets.add(value.replace(/^\.\//, '')); }
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  [metadata.main, metadata.types, metadata.typings, metadata.bin, metadata.exports].forEach(collect);
  return [...targets].map(target => `package/${target}`).sort();
}

/** Published client packages expose only public runtime/type files, never test programs. */
export function auditClientArtifactFiles(files, metadata) {
  const forbidden = files.filter(name => /(?:^|\/)(?:__tests__|tests|type-tests)(?:\/|$)|\.(?:test|type-test)\./.test(name));
  const missing = declaredEntrypoints(metadata).filter(name => !files.includes(name));
  if (forbidden.length || missing.length) {
    throw new Error(`Invalid client package contents: ${forbidden.length} test artifacts, missing ${missing.join(', ') || 'none'}.\n${forbidden.slice(0, 10).join('\n')}`);
  }
}
