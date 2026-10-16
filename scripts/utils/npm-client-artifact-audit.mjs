/** Published client packages expose only public runtime/type files, never test programs. */
export function auditClientArtifactFiles(files) {
  const forbidden = files.filter(name => /(?:^|\/)(?:__tests__|tests|type-tests)(?:\/|$)|\.(?:test|type-test)\./.test(name));
  const missing = ['package/package.json', 'package/dist/index.js', 'package/dist/index.d.ts'].filter(name => !files.includes(name));
  if (forbidden.length || missing.length) {
    throw new Error(`Invalid client package contents: ${forbidden.length} test artifacts, missing ${missing.join(', ') || 'none'}.\n${forbidden.slice(0, 10).join('\n')}`);
  }
}
