import type { DeploymentSubmissionResponse as BaseResponse } from '@hypequery/deployment';
import type { DeploymentSubmissionResponse } from '../src/utils/deployment-upload.js';

// Existing consumers can keep treating the response as the provider-neutral type.
export function asBase(response: DeploymentSubmissionResponse): BaseResponse {
  return response;
}
export function readDraft(response: DeploymentSubmissionResponse): string | undefined {
  return response.draft?.stagingUrl;
}
// Existing transport implementations can continue returning the original shape.
export function fromBase(response: BaseResponse): DeploymentSubmissionResponse {
  return response;
}
