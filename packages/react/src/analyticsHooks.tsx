import type {
  UseQueryOptions as TanstackUseQueryOptions,
  UseQueryResult,
} from '@tanstack/react-query';
import { createHooks, type CreateHooksConfig } from './createHooks.js';
import { HttpError } from './errors.js';
import type { ExtractNames, QueryInput, QueryOutput } from './types.js';

type DatasetKey<Name extends string> = `dataset:${Name}`;
type DatasetNamesFromApi<Api> =
  ExtractNames<Api> extends infer Key
    ? Key extends `dataset:${infer Name}`
      ? Name
      : never
    : never;

type QueryKey<Name extends string, Input> = Input extends never
  ? ['hypequery', Name]
  : ['hypequery', Name, Input];

type QueryOptions<Api, Key extends ExtractNames<Api>> = Omit<
  TanstackUseQueryOptions<
    QueryOutput<Api, Key>,
    HttpError,
    QueryOutput<Api, Key>,
    QueryKey<Key, QueryInput<Api, Key>>
  >,
  'queryKey' | 'queryFn'
>;

type MetricQueryParams<Api, Key extends ExtractNames<Api>> =
  QueryInput<Api, Key> extends never
    ? [name: Key, options?: QueryOptions<Api, Key>]
    : [name: Key, input: QueryInput<Api, Key>, options?: QueryOptions<Api, Key>];

type DatasetQueryParams<Api, Name extends DatasetNamesFromApi<Api>> =
  QueryInput<Api, Extract<ExtractNames<Api>, DatasetKey<Name>>> extends never
    ? [name: Name, options?: QueryOptions<Api, Extract<ExtractNames<Api>, DatasetKey<Name>>>]
    : [
        name: Name,
        input: QueryInput<Api, Extract<ExtractNames<Api>, DatasetKey<Name>>>,
        options?: QueryOptions<Api, Extract<ExtractNames<Api>, DatasetKey<Name>>>,
      ];

export interface CreateAnalyticsHooksConfig<
  Api extends Record<string, { input: any; output: any }>,
  TMetrics extends readonly Exclude<ExtractNames<Api>, `dataset:${string}`>[] = readonly Exclude<ExtractNames<Api>, `dataset:${string}`>[],
> extends CreateHooksConfig<Api> {
  metrics?: TMetrics;
}

export function createAnalyticsHooks<
  Api extends Record<string, { input: any; output: any }>,
  const TMetrics extends readonly Exclude<ExtractNames<Api>, `dataset:${string}`>[] = readonly Exclude<ExtractNames<Api>, `dataset:${string}`>[],
>(config: CreateAnalyticsHooksConfig<Api, TMetrics>) {
  const hooks = createHooks<Api>(config);
  type MetricName = TMetrics extends readonly (infer U)[]
    ? U extends string
      ? U
      : never
    : Exclude<ExtractNames<Api>, `dataset:${string}`>;

  function useMetric<Name extends MetricName>(
    ...args: MetricQueryParams<Api, Name>
  ): UseQueryResult<QueryOutput<Api, Name>, HttpError> {
    const [name, ...rest] = args as [Name, ...unknown[]];
    return (hooks.useQuery as any)(name, ...rest);
  }

  function useDataset<Name extends DatasetNamesFromApi<Api>>(
    ...args: DatasetQueryParams<Api, Name>
  ): UseQueryResult<QueryOutput<Api, Extract<ExtractNames<Api>, DatasetKey<Name>>>, HttpError> {
    const [name, ...rest] = args as [Name, ...unknown[]];
    const key = `dataset:${String(name)}` as Extract<ExtractNames<Api>, DatasetKey<Name>>;
    return (hooks.useQuery as any)(key, ...rest);
  }

  return {
    ...hooks,
    useMetric,
    useDataset,
  } as const;
}
