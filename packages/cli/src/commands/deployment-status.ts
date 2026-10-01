import {
  resolveDeploymentCredential,
  type CloudDeploymentAccessDependencies,
} from '../utils/cloud-deployment-access.js';
import { deploymentTargetFromOptions } from '../utils/deployment-target.js';
import { fetchHostedEndpoints } from '../utils/hosted-endpoints.js';
import { printHostedEndpoints } from '../utils/hosted-endpoints-output.js';
import { fetchLiveDeployment } from '../utils/live-deployment.js';
import { logger } from '../utils/logger.js';

export interface DeploymentStatusOptions {
  readonly endpoint?: string;
  readonly project?: string;
  readonly environment?: string;
  readonly mcpConfig?: boolean;
}

export interface DeploymentStatusDependencies extends CloudDeploymentAccessDependencies {
  readonly fetchLive?: typeof fetchLiveDeployment;
  readonly fetchEndpoints?: typeof fetchHostedEndpoints;
}

/** Read the current target and its hosted connection details without deploying. */
export async function deploymentStatusCommand(
  options: DeploymentStatusOptions = {},
  dependencies: DeploymentStatusDependencies = {},
): Promise<void> {
  const access = await resolveDeploymentCredential(options.endpoint, dependencies);
  const target = deploymentTargetFromOptions(options, access.storedCredential);
  const live = await (dependencies.fetchLive ?? fetchLiveDeployment)({
    endpoint: access.endpoint,
    token: access.token,
    target,
    resource: 'state',
  });
  if (!live) {
    throw new Error('Cloud did not return deployment status for this target.');
  }

  logger.info(`Target: ${target.project} / ${target.environment}`);
  if (live.active) {
    logger.success(`Live release: ${live.active.releaseIdentity}`);
    logger.info(`Activated: ${live.active.activatedAt}`);
    if (live.active.restored) logger.info('This release was restored from history.');
  } else {
    logger.info('No live release yet.');
  }

  const endpoints = await (dependencies.fetchEndpoints ?? fetchHostedEndpoints)({
    endpoint: access.endpoint,
    token: access.token,
    target,
  });
  if (endpoints) printHostedEndpoints(endpoints, options.mcpConfig === true);
  else logger.warn('Cloud did not return hosted endpoint details.');
}
