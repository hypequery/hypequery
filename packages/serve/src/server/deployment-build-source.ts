const deploymentBuildSourceSymbol = Symbol.for('hypequery.deployment-build-source.v1');

interface DeploymentBuildSource {
  readonly version: 1;
  readonly runtimeEntrypoints: readonly string[];
}

export function attachDeploymentBuildSource(
  target: object,
  runtimeEntrypoints: readonly string[],
): void {
  const source: DeploymentBuildSource = Object.freeze({
    version: 1,
    runtimeEntrypoints: Object.freeze([...new Set(runtimeEntrypoints)].sort()),
  });
  Object.defineProperty(target, deploymentBuildSourceSymbol, {
    value: source,
    enumerable: false,
    configurable: false,
    writable: false,
  });
}
