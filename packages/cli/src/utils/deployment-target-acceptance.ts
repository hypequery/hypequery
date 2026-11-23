import {
  DEFAULT_PROTOCOL_DEPLOYMENT_TARGET_ACCEPTS,
  PROTOCOL_CONTRACT_3_FEATURE_LABELS,
  checkProtocolDeploymentTargetAcceptance,
  type ProtocolDeploymentContractAnyVersion,
  type ProtocolDeploymentReleaseTarget,
  type ProtocolDeploymentTargetAccepts,
  type ProtocolDeploymentTargetRefusal,
} from '@hypequery/protocol';
import { CliError, type CliInputIssue } from './cli-error.js';
import { liveUrl, type LiveDeployment } from './live-deployment.js';

/**
 * What to check a deployment against, from a `state` read (RFC 0030): the
 * target's advertisement, with Cloud's defaults when it sent none or when a
 * Cloud target answered `404`. An endpoint with no state resource advertises
 * nothing, so there is nothing to check and its intake decides.
 */
export function liveTargetAccepts(
  live: LiveDeployment | undefined,
  endpoint: string,
  target: ProtocolDeploymentReleaseTarget,
): ProtocolDeploymentTargetAccepts | undefined {
  if (live) return live.accepts ?? DEFAULT_PROTOCOL_DEPLOYMENT_TARGET_ACCEPTS;
  return liveUrl(endpoint, target, 'state') === undefined ? undefined : DEFAULT_PROTOCOL_DEPLOYMENT_TARGET_ACCEPTS;
}

/** "contract 2", "contracts 2 and 3", "contracts 1, 2 and 3". */
function versionList(noun: string, versions: readonly number[]): string {
  if (versions.length === 1) return `${noun} ${versions[0]}`;
  return `${noun}s ${versions.slice(0, -1).join(', ')} and ${versions[versions.length - 1]}`;
}

function describe(target: string, refusal: ProtocolDeploymentTargetRefusal): { text: string; issues: CliInputIssue[] } {
  if (refusal.kind === 'bundle') {
    const reason = refusal.version === 2 ? ' because it carries business context' : '';
    return {
      text: `${target} accepts ${versionList('deployment bundle version', refusal.accepted)}, `
        + `but this bundle is version ${refusal.version}${reason}. `
        + `Remove the business context, or deploy to a target that accepts bundle version ${refusal.version}.`,
      issues: [{ path: 'bundle', message: `Bundle version ${refusal.version} is not accepted by ${target}.` }],
    };
  }
  const accepted = versionList('deployment contract', refusal.accepted);
  if (refusal.forcedBy.length === 0) {
    return {
      text: `${target} accepts ${accepted}, but this deployment is contract ${refusal.version}: `
        + 'it uses no feature that needs a later version. Check that you are deploying to the intended target.',
      issues: [{ path: 'deployment', message: `Contract ${refusal.version} is not accepted by ${target}.` }],
    };
  }
  const lines = refusal.forcedBy.map(({ dataset, features }) => (
    `${dataset} uses ${features.map(feature => PROTOCOL_CONTRACT_3_FEATURE_LABELS[feature]).join(', ')}`
  ));
  return {
    text: `${target} accepts ${accepted}, but this deployment is contract ${refusal.version}.\n`
      + lines.map(line => `  ${line}\n`).join('')
      + `Remove these features, or deploy to a target that accepts contract ${refusal.version}. `
      + 'The CLI never lowers the version, because that would drop them.',
    issues: refusal.forcedBy.map(({ dataset }, index) => ({ path: `datasets.${dataset}`, message: lines[index]! })),
  };
}

/**
 * Refuse, before anything is uploaded, a deployment whose contract or bundle
 * version the target does not advertise (RFC 0030). Versions follow content;
 * this never rewrites the deployment to fit.
 */
export function assertDeploymentTargetAccepts(input: {
  readonly target: ProtocolDeploymentReleaseTarget;
  readonly contract: ProtocolDeploymentContractAnyVersion;
  readonly bundleVersion: number;
  readonly accepts: ProtocolDeploymentTargetAccepts;
}): void {
  const refusals = checkProtocolDeploymentTargetAcceptance(input);
  if (refusals.length === 0) return;
  const target = `${input.target.project}/${input.target.environment}`;
  const described = refusals.map(refusal => describe(target, refusal));
  throw new CliError('DEPLOYMENT_VERSION_UNSUPPORTED', described.map(entry => entry.text).join('\n\n'), {
    hint: 'Remove the features named above, or deploy to a target that accepts the version.',
    category: 'correctable_input',
    issues: described.flatMap(entry => entry.issues),
  });
}
