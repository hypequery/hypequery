import type {
  UseQueryOptions as TanstackUseQueryOptions,
  UseQueryResult,
  UseInfiniteQueryResult,
  InfiniteData,
} from '@tanstack/react-query';
import { createHooks, type CreateHooksConfig } from './createHooks.js';
import { HttpError } from './errors.js';
import type { ExtractNames, QueryInput, QueryOutput, QueryOutputForInput } from './types.js';

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

export interface CreateAnalyticsHooksConfig<
  Api extends Record<string, { input: any; output: any }>,
  TMetrics extends readonly Exclude<ExtractNames<Api>, `dataset:${string}`>[] = readonly Exclude<ExtractNames<Api>, `dataset:${string}`>[],
> extends CreateHooksConfig<Api> {
  metrics?: TMetrics;
}

export function createAnalyticsHooks<
  Api extends Record<string, { input: any; output: any }>,
  TMetrics extends readonly Exclude<ExtractNames<Api>, `dataset:${string}`>[] = readonly Exclude<ExtractNames<Api>, `dataset:${string}`>[],
>(config: CreateAnalyticsHooksConfig<Api, TMetrics>) {
  const hooks = createHooks<Api>(config);
  type MetricName = TMetrics extends readonly (infer U)[]
    ? U extends string
      ? U
      : never
    : Exclude<ExtractNames<Api>, `dataset:${string}`>;

  function useMetric<Name extends MetricName>(
    ...args: QueryInput<Api, Name> extends never ? [name: Name, options?: QueryOptions<Api, Name>] : never
  ): UseQueryResult<QueryOutput<Api, Name>, HttpError>;
  function useMetric<Name extends MetricName, const TInput extends QueryInput<Api, Name>>(
    name: Name,
    input: TInput,
    options?: QueryOptions<Api, Name>,
  ): UseQueryResult<QueryOutputForInput<Api, Name, TInput>, HttpError>;
  function useMetric(
    ...args: any[]
  ): UseQueryResult<any, HttpError> {
    const [name, ...rest] = args as [string, ...unknown[]];
    return (hooks.useQuery as any)(name, ...rest);
  }

  function useDataset<Name extends DatasetNamesFromApi<Api>>(
    ...args: QueryInput<Api, Extract<ExtractNames<Api>, DatasetKey<Name>>> extends never
      ? [name: Name, options?: QueryOptions<Api, Extract<ExtractNames<Api>, DatasetKey<Name>>>]
      : never
  ): UseQueryResult<QueryOutput<Api, Extract<ExtractNames<Api>, DatasetKey<Name>>>, HttpError>;
  function useDataset<
    Name extends DatasetNamesFromApi<Api>,
    const TInput extends QueryInput<Api, Extract<ExtractNames<Api>, DatasetKey<Name>>>,
  >(
    name: Name,
    input: TInput,
    options?: QueryOptions<Api, Extract<ExtractNames<Api>, DatasetKey<Name>>>,
  ): UseQueryResult<QueryOutputForInput<Api, Extract<ExtractNames<Api>, DatasetKey<Name>>, TInput>, HttpError>;
  function useDataset(
    ...args: any[]
  ): UseQueryResult<any, HttpError> {
    const [name, ...rest] = args as [string, ...unknown[]];
    const key = `dataset:${String(name)}` as Extract<ExtractNames<Api>, DatasetKey<string>>;
    return (hooks.useQuery as any)(key, ...rest);
  }

  function useInfiniteMetric<Name extends MetricName>(
    name: Name,
    input: QueryInput<Api, Name>,
    options?: Parameters<typeof hooks.useInfiniteQuery>[2],
  ): UseInfiniteQueryResult<InfiniteData<QueryOutput<Api, Name>, number>, HttpError> {
    return (hooks.useInfiniteQuery as any)(name, input, options);
  }

  function useInfiniteDataset<Name extends DatasetNamesFromApi<Api>>(
    name: Name,
    input: QueryInput<Api, Extract<ExtractNames<Api>, DatasetKey<Name>>>,
    options?: Parameters<typeof hooks.useInfiniteQuery>[2],
  ): UseInfiniteQueryResult<
    InfiniteData<QueryOutput<Api, Extract<ExtractNames<Api>, DatasetKey<Name>>>, number>,
    HttpError
  > {
    const key = `dataset:${String(name)}` as Extract<ExtractNames<Api>, DatasetKey<Name>>;
    return (hooks.useInfiniteQuery as any)(key, input, options);
  }

  return {
    ...hooks,
    useMetric,
    useDataset,
    useInfiniteMetric,
    useInfiniteDataset,
  } as const;
}
