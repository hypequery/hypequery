import type { MCPErrorDetails, MCPToolErrorCategory, MCPToolErrorCode } from '@hypequery/mcp';
import type {
  HypequeryToolErrorCategory,
  HypequeryToolErrorCode,
  HypequeryToolErrorDetails,
} from '../src/index.js';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

// The envelope mirrors @hypequery/mcp's, so it stays a copy, never a re-typing.
export type CodesMatch = Expect<Equal<HypequeryToolErrorCode, MCPToolErrorCode>>;
export type CategoriesMatch = Expect<Equal<HypequeryToolErrorCategory, MCPToolErrorCategory>>;
export type KeysMatch = Expect<Equal<keyof HypequeryToolErrorDetails, keyof MCPErrorDetails>>;

declare const server: MCPErrorDetails;
const envelope: HypequeryToolErrorDetails = server;
void envelope;
