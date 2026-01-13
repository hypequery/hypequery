export type HypequeryApiRecord = Record<string, { input: unknown; output: unknown }>;

export type ExtractNames<Api extends HypequeryApiRecord> = Extract<keyof Api, string>;

export type QueryInput<Api extends HypequeryApiRecord, Name extends ExtractNames<Api>> =
  Api[Name] extends { input: infer Input }
    ? Input
    : never;

export type QueryOutput<Api extends HypequeryApiRecord, Name extends ExtractNames<Api>> =
  Api[Name] extends { output: infer Output }
    ? Output
    : never;
