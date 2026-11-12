import { emitType, jsDoc, literal, propertyKey, type JsonSchema } from './json-schema-to-ts.ts';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type SpecOperation = {
  readonly name: string;
  readonly summary: string;
  readonly scope: 'organization' | 'project';
  readonly capability: string;
  readonly destructive: boolean;
  readonly connector?: boolean;
  readonly http: { readonly method: HttpMethod; readonly path: string };
  readonly input: JsonSchema;
  readonly output: JsonSchema;
  readonly errors: readonly string[];
};

export type SpecError = {
  readonly status: number;
  readonly category: string;
  readonly retryable: boolean;
  readonly hint: string;
  readonly docsUrl: string;
};

export type OperationsSpec = {
  readonly kind: string;
  readonly version: number;
  readonly basePath: string;
  readonly operations: readonly SpecOperation[];
  readonly errorCategories: readonly string[];
  readonly errors: Readonly<Record<string, SpecError>>;
};

const HTTP_METHODS: readonly string[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const OPERATION_NAME = /^[a-z][A-Za-z0-9]*\.[a-z][A-Za-z0-9]*$/;

/** Fails loudly on a spec the client can't represent, before any code is written. */
export function assertSpec(value: unknown): asserts value is OperationsSpec {
  const spec = value as OperationsSpec;
  if (!spec || spec.kind !== 'hypequery-cloud-operations') {
    throw new Error('Not a hypequery Cloud operations spec (kind must be "hypequery-cloud-operations").');
  }
  if (spec.version !== 1) throw new Error(`Unsupported operations spec version ${String(spec.version)}.`);
  const names = new Set<string>();
  for (const operation of spec.operations) {
    if (!OPERATION_NAME.test(operation.name)) {
      throw new Error(`Operation name "${operation.name}" isn't "resource.verb".`);
    }
    if (operation.name.startsWith('call.')) {
      throw new Error(`${operation.name}: "call" is reserved for the client's generic call().`);
    }
    if (names.has(operation.name)) throw new Error(`Operation "${operation.name}" is listed twice.`);
    names.add(operation.name);
    if (!HTTP_METHODS.includes(operation.http.method)) {
      throw new Error(`${operation.name}: unsupported method ${operation.http.method}.`);
    }
    const inputProperties = operation.input.properties ?? {};
    for (const param of pathParams(operation.http.path)) {
      if (!(param in inputProperties)) {
        throw new Error(`${operation.name}: path parameter {${param}} isn't an input property.`);
      }
    }
    if (operation.destructive && 'confirm' in inputProperties) {
      throw new Error(`${operation.name}: the input already declares "confirm".`);
    }
    for (const code of operation.errors) {
      if (!(code in spec.errors)) throw new Error(`${operation.name}: unknown error code ${code}.`);
    }
  }
}

export function pathParams(path: string): string[] {
  return [...path.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)].map((match) => match[1]!);
}

/** `drafts.applyUpdate` → `DraftsApplyUpdate`. */
export function typeBaseName(operationName: string): string {
  return operationName
    .split('.')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

const CONFIRM_SCHEMA: JsonSchema = {
  const: true,
  description:
    'This operation is destructive: set `confirm: true` once the user has agreed to it. The server refuses it otherwise (CONFIRMATION_REQUIRED).',
};

/** The input schema the client exposes: destructive operations also require `confirm: true`. */
export function clientInputSchema(operation: SpecOperation): JsonSchema {
  if (!operation.destructive) return operation.input;
  return {
    ...operation.input,
    properties: { ...(operation.input.properties ?? {}), confirm: CONFIRM_SCHEMA },
    required: [...(operation.input.required ?? []), 'confirm'],
  };
}

function hasRequiredInput(operation: SpecOperation): boolean {
  return (clientInputSchema(operation).required ?? []).length > 0;
}

function declaration(name: string, schema: JsonSchema, doc: string): string {
  const type = emitType(schema);
  const keyword = type.startsWith('{') ? `export interface ${name} ` : `export type ${name} = `;
  return `${doc}${keyword}${type}${type.startsWith('{') ? '' : ';'}\n`;
}

function operationDoc(operation: SpecOperation, indent: string): string {
  return jsDoc({ description: operation.summary }, indent, [
    '',
    `\`${operation.http.method} ${operation.http.path}\` · ${operation.scope} scope · needs \`${operation.capability}\``,
    ...(operation.destructive ? ['Destructive: requires `confirm: true`.'] : []),
    `Errors: ${operation.errors.join(', ')}`,
  ]);
}

function renderTypes(operation: SpecOperation): string {
  const base = typeBaseName(operation.name);
  return [
    declaration(`${base}Input`, clientInputSchema(operation), `/** Input for \`${operation.name}\`. */\n`),
    declaration(`${base}Output`, operation.output, `/** Output of \`${operation.name}\`. */\n`),
  ].join('\n');
}

function renderOperationMeta(operation: SpecOperation): string {
  const fields = [
    `name: ${literal(operation.name)}`,
    `summary: ${literal(operation.summary)}`,
    `scope: ${literal(operation.scope)}`,
    `capability: ${literal(operation.capability)}`,
    `destructive: ${operation.destructive}`,
    `method: ${literal(operation.http.method)}`,
    `path: ${literal(operation.http.path)}`,
    `pathParams: ${literal(pathParams(operation.http.path))}`,
    `errors: ${literal(operation.errors)}`,
  ];
  return `  ${literal(operation.name)}: {\n${fields.map((field) => `    ${field},`).join('\n')}\n  },`;
}

function renderOperationMap(operations: readonly SpecOperation[]): string {
  const entries = operations.map((operation) => {
    const base = typeBaseName(operation.name);
    return `  ${literal(operation.name)}: {\n    input: ${base}Input;\n    output: ${base}Output;\n    inputRequired: ${hasRequiredInput(operation)};\n  };`;
  });
  return `/** Input and output types for every operation, by name. */\nexport interface CloudOperationTypes {\n${entries.join('\n')}\n}\n`;
}

function renderClientInterface(operations: readonly SpecOperation[]): string {
  const groups = new Map<string, SpecOperation[]>();
  for (const operation of operations) {
    const [resource] = operation.name.split('.');
    groups.set(resource!, [...(groups.get(resource!) ?? []), operation]);
  }
  const blocks = [...groups].map(([resource, members]) => {
    const methods = members.map((operation) => {
      const base = typeBaseName(operation.name);
      const verb = operation.name.split('.')[1]!;
      const input = hasRequiredInput(operation) ? `input: ${base}Input` : `input?: ${base}Input`;
      return `${operationDoc(operation, '    ')}    ${propertyKey(verb)}(${input}, options?: CallOptions): Promise<${base}Output>;`;
    });
    return `  ${propertyKey(resource)}: {\n${methods.join('\n')}\n  };`;
  });
  return `/** One method per Cloud operation, grouped by resource: \`client.drafts.promote(...)\`. */\nexport interface CloudClientOperations {\n${blocks.join('\n')}\n}\n`;
}

function renderErrors(spec: OperationsSpec): string {
  const codes = Object.keys(spec.errors);
  const catalog = codes.map((code) => {
    const error = spec.errors[code]!;
    const fields = [
      `status: ${error.status}`,
      `category: ${literal(error.category)}`,
      `retryable: ${error.retryable}`,
      `hint: ${literal(error.hint)}`,
      `docsUrl: ${literal(error.docsUrl)}`,
    ];
    return `  ${propertyKey(code)}: {\n${fields.map((field) => `    ${field},`).join('\n')}\n  },`;
  });
  return [
    `/** Every error category, in the order Cloud lists them. */`,
    `export const CLOUD_ERROR_CATEGORIES = ${literal(spec.errorCategories)} as const;`,
    `export type CloudErrorCategory = (typeof CLOUD_ERROR_CATEGORIES)[number];`,
    '',
    `/** Every error code an operation can return, with what to do about it. */`,
    `export const CLOUD_ERRORS = {\n${catalog.join('\n')}\n} as const satisfies Record<string, CloudErrorSpec>;`,
    `export type CloudErrorCode = keyof typeof CLOUD_ERRORS;`,
    '',
  ].join('\n');
}

/** The whole generated module for `spec`. Deterministic: same spec, same bytes. */
export function renderClientModule(spec: OperationsSpec): string {
  assertSpec(spec);
  const sections = [
    `// Generated by packages/cloud-client/codegen/generate.ts from specs/cloud-api/operations-v1.json.`,
    `// Do not edit by hand: run \`pnpm --filter @hypequery/cloud-client generate\`.`,
    `/* eslint-disable */`,
    '',
    `import type { CallOptions, CloudErrorSpec, OperationMeta } from '../types.js';`,
    '',
    `/** The operations spec version this client was generated from. */`,
    `export const SPEC_VERSION = ${spec.version};`,
    `/** Every operation path is relative to this. */`,
    `export const BASE_PATH = ${literal(spec.basePath)};`,
    '',
    renderErrors(spec),
    ...spec.operations.map(renderTypes),
    renderOperationMap(spec.operations),
    `/** Route and policy for every operation, by name. */`,
    `export const OPERATIONS = {\n${spec.operations.map(renderOperationMeta).join('\n')}\n} as const satisfies Record<string, OperationMeta>;`,
    `export type CloudOperationName = keyof typeof OPERATIONS;`,
    '',
    renderClientInterface(spec.operations),
  ];
  return sections.join('\n');
}
