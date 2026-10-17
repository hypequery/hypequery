import {
  buildClientContractQuerySchemas,
  type ClientContractQuerySchemas,
} from '../src/index.js';
import {
  validateProtocolClientContract,
  validateProtocolClientQuery,
  type ProtocolClientContract,
  type ClientQueryPlan,
  type ProtocolClientContractErrorCode,
} from '@hypequery/protocol';

declare const source: unknown;
const contract: ProtocolClientContract = validateProtocolClientContract(source);
const schemas: ClientContractQuerySchemas = buildClientContractQuerySchemas(contract);
const query: ClientQueryPlan = validateProtocolClientQuery(contract, 'orders', {});
const path: string | undefined = schemas.endpoints.get('orders')?.endpoint.path;
const code: ProtocolClientContractErrorCode = 'HQ_CLIENT_QUERY';
// @ts-expect-error Contract properties are read-only snapshots.
contract.view = 'authorized';
// @ts-expect-error Endpoint arrays cannot be mutated.
contract.endpoints.push(contract.endpoints[0]);
// @ts-expect-error Query plans cannot be retargeted.
query.endpoint = contract.endpoints[0];
// @ts-expect-error Transport names form a closed public union.
validateProtocolClientQuery(contract, 'orders', {}, 'remote');
// @ts-expect-error Stable errors form a closed public union.
const invalidCode: ProtocolClientContractErrorCode = 'SECRET';
void [path, code, invalidCode];
