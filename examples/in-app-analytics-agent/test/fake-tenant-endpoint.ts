import { createPublicKey, generateKeyPairSync, randomBytes } from 'node:crypto';
import { publishDatasets } from '@hypequery/datasets';
import {
  createMCPExecutor,
  createMCPHttpHandler,
  listenMCPHttpServer,
  MCPHttpAuthError,
  MCPToolError,
  type MCPToolExecutor,
} from '@hypequery/mcp';
import { errors as joseErrors, jwtVerify } from 'jose';
import { Events } from '../analytics/datasets';
import { analytics } from './seed';

/**
 * hypequery Cloud's tenant MCP endpoint, in process, for tests: no Cloud, no
 * network. It does what Cloud does with an in-app agent token:
 *
 * - verifies the EdDSA signature against the signing key's public half, the
 *   `kid`, the audience `hypequery-agent:<project>` and the 15-minute ceiling;
 * - takes the tenant from the token's `tenant` claim, and nowhere else;
 * - serves the tenant tool set (list_datasets, get_dataset_schema,
 *   query_dataset) over `analytics/datasets.ts`, the same file you deploy,
 *   on the shared seed in ClickHouse.
 */
export const TENANT_TOOLS = ['list_datasets', 'get_dataset_schema', 'query_dataset'];
export const PROJECT = 'demo:in-app-agent';
export const PERMISSION_SET = 'customers';

export interface VerifiedCall {
  subject: string;
  tenant: string;
  permissionSet: string;
}

export interface FakeTenantEndpoint {
  /** The signing key JSON, as Cloud shows it once: set it as HYPEQUERY_AGENT_KEY. */
  signingKey: string;
  /** Every token the endpoint accepted, decoded. */
  verified: VerifiedCall[];
  close(): Promise<void>;
}

/** Cloud's tenant tool set only: no `query_metric`, nothing else. */
function tenantTools(executor: MCPToolExecutor): MCPToolExecutor {
  return {
    listTools: async (signal) => {
      const listed = await executor.listTools(signal);
      return { ...listed, tools: listed.tools.filter((tool) => TENANT_TOOLS.includes(tool.name)) };
    },
    callTool: (name, args, signal) => {
      if (!TENANT_TOOLS.includes(name)) throw new MCPToolError('MCP_UNKNOWN_TOOL', `Unknown tool: ${name}`);
      return executor.callTool(name, args, signal);
    },
    listPrompts: (signal) => executor.listPrompts(signal),
    getPrompt: (name, args, signal) => executor.getPrompt(name, args, signal),
    getManifestHash: () => executor.getManifestHash(),
  };
}

export async function startFakeTenantEndpoint(): Promise<FakeTenantEndpoint> {
  const kid = `hqsk_${randomBytes(16).toString('base64url')}`;
  const { privateKey } = generateKeyPairSync('ed25519');
  const jwk = privateKey.export({ format: 'jwk' });
  const publicKey = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: jwk.x! }, format: 'jwk' });
  const datasets = publishDatasets().publish(Events).build();
  const verified: VerifiedCall[] = [];

  const handler = createMCPHttpHandler({
    allowedHosts: ['127.0.0.1'],
    authenticate: async (request) => {
      const header = request.headers.get('authorization');
      if (header === null) return null;
      try {
        const { payload } = await jwtVerify(
          header.replace(/^Bearer /, ''),
          (protectedHeader) => {
            if (protectedHeader.kid !== kid) throw new joseErrors.JWKSNoMatchingKey();
            return publicKey;
          },
          { algorithms: ['EdDSA'], audience: `hypequery-agent:${PROJECT}`, requiredClaims: ['sub', 'iat', 'exp'], maxTokenAge: 900 },
        );
        if (payload.permission_set !== PERMISSION_SET) throw new Error('unknown permission set');
        const call = { subject: String(payload.sub), tenant: String(payload.tenant), permissionSet: PERMISSION_SET };
        verified.push(call);
        // The tenant is the signed claim. Tool arguments can't change it.
        return { subject: call.subject, tenantId: call.tenant };
      } catch (error) {
        throw new MCPHttpAuthError('invalid_token', (error as Error).message);
      }
    },
    createExecutor: (principal) => tenantTools(createMCPExecutor({ datasets, analytics, tenantId: principal.tenantId })),
  });
  const listener = await listenMCPHttpServer(handler, { port: 0 });
  // Cloud's key JSON names the project and its customer endpoint, so minting needs nothing else.
  const signingKey = JSON.stringify({
    ...jwk,
    kid,
    alg: 'EdDSA',
    use: 'sig',
    hq_project: PROJECT,
    hq_endpoint: listener.url,
  });
  return { signingKey, verified, close: () => listener.close() };
}
