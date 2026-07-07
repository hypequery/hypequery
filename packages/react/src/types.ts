export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type KnownStringKeys<T> = {
  [K in keyof T]: string extends K ? never : K extends string ? K : never;
}[keyof T];

export type ExtractNames<Api> = [KnownStringKeys<Api>] extends [never]
  ? Extract<keyof Api, string>
  : KnownStringKeys<Api>;

export type QueryInput<
  Api,
  Name extends ExtractNames<Api>
> = Api[Name] extends { input: infer Input } ? Input : never;

export type QueryOutput<
  Api,
  Name extends ExtractNames<Api>
> = Api[Name] extends { output: infer Output } ? Output : never;

type SemanticInfo<Api, Name extends ExtractNames<Api>> =
  Api[Name] extends { readonly __hypequerySemantic?: infer Info }
    ? NonNullable<Info>
    : never;

type DimensionValue<TDefinition> =
  TDefinition extends { fieldType: 'string' } ? string :
  TDefinition extends { fieldType: 'number' } ? number :
  TDefinition extends { fieldType: 'boolean' } ? boolean :
  TDefinition extends { fieldType: 'timestamp' } ? string :
  unknown;

type SelectedDimensions<TDimensions, TInput> =
  TInput extends { dimensions: readonly (infer TName)[] }
    ? Extract<TName, KnownStringKeys<TDimensions>>
    : never;

type SelectedMeasures<TMeasures, TInput> =
  TInput extends { measures: readonly (infer TName)[] }
    ? Extract<TName, KnownStringKeys<TMeasures>>
    : KnownStringKeys<TMeasures>;

type PeriodSelection<TInput> = TInput extends { by: string }
  ? { period?: string }
  : {};

type WithTypedData<TOutput, TRow> = Omit<TOutput, 'data'> & {
  data: TRow[];
};

// Measure/metric values are `string`: ClickHouse serializes aggregate results
// (UInt64, Decimal, ...) as strings over JSON, matching @hypequery/datasets.
type DatasetOutputForInput<TInfo, TInput, TFallback> =
  TInfo extends { kind: 'dataset'; dimensions: infer TDimensions; measures: infer TMeasures }
    ? WithTypedData<
        TFallback,
        & { [K in SelectedDimensions<TDimensions, TInput>]?: DimensionValue<TDimensions[K]> }
        & { [K in SelectedMeasures<TMeasures, TInput>]?: string }
        & PeriodSelection<TInput>
      >
    : TFallback;

type MetricOutputForInput<TInfo, TInput, TFallback> =
  TInfo extends {
    kind: 'metric';
    dimensions: infer TDimensions;
    metricName: infer TMetricName extends string;
  }
    ? WithTypedData<
        TFallback,
        & { [K in SelectedDimensions<TDimensions, TInput>]?: DimensionValue<TDimensions[K]> }
        & { [K in TMetricName]?: string }
        & PeriodSelection<TInput>
      >
    : TFallback;

export type QueryOutputForInput<
  Api,
  Name extends ExtractNames<Api>,
  TInput,
> = SemanticInfo<Api, Name> extends infer Info
  ? Info extends { kind: 'dataset' }
    ? DatasetOutputForInput<Info, TInput, QueryOutput<Api, Name>>
    : Info extends { kind: 'metric' }
      ? MetricOutputForInput<Info, TInput, QueryOutput<Api, Name>>
      : QueryOutput<Api, Name>
  : QueryOutput<Api, Name>;
