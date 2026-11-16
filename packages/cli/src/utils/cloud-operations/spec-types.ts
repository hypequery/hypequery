/** A JSON Schema node from operations-v1.json, as far as the CLI reads it. */
export interface JsonSchema {
  readonly type?: string | readonly string[];
  readonly description?: string;
  readonly enum?: readonly unknown[];
  readonly const?: unknown;
  readonly default?: unknown;
  readonly items?: JsonSchema;
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly anyOf?: readonly JsonSchema[];
  readonly oneOf?: readonly JsonSchema[];
  readonly [keyword: string]: unknown;
}

/** One operation of hypequery Cloud's `/v1` API, as generated from operations-v1.json. */
export interface CloudOperationSpec {
  /** `resource.verb`, e.g. `releases.rollback`. */
  readonly name: string;
  readonly summary: string;
  readonly scope: 'organization' | 'project';
  /** The capability the caller's role needs; Cloud checks it. */
  readonly capability: string;
  /** Needs `confirm: true`; the CLI asks for `--yes`. */
  readonly destructive: boolean;
  /** Offered on Claude's connector too. False for operations that return or take a secret. */
  readonly connector: boolean;
  readonly method: string;
  /** Under `/v1`; `{name}` segments come from the input. */
  readonly path: string;
  readonly input: JsonSchema;
}
