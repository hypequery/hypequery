import { createHooks, queryOptions, type QueryInput, type QueryOutput } from '../src/index.js';
import type { Expect, Equal } from '@type-challenges/utils';

type Api = {
  listUsers: {
    input: {
      search: string;
      tags?: string[];
    };
    output: Array<{ id: string; name: string }>;
  };
  stats: {
    input: void;
    output: { total: number };
  };
  createUser: {
    input: { name: string };
    output: { id: string; name: string };
  };
};

const hooks = createHooks<Api>({ baseUrl: 'https://api.example.com' });

// QueryInput / QueryOutput helpers retain declared types
export type _ListUsersInput = Expect<
  Equal<QueryInput<Api, 'listUsers'>, { search: string; tags?: string[] }>
>;
export type _StatsOutput = Expect<
  Equal<QueryOutput<Api, 'stats'>, { total: number }>
>;

// Valid invocations
hooks.useQuery('listUsers', { search: 'Luke' });
hooks.useQuery('listUsers', { search: 'Luke', tags: ['admin'] }, queryOptions({ enabled: true }));
hooks.useQuery('stats');
hooks.useQuery('stats', undefined, queryOptions({ enabled: false, staleTime: 1_000 }));
const mutation = hooks.useMutation('createUser');
mutation.mutate({ name: 'Leia' });

// Invalid usages should surface type errors
// @ts-expect-error missing required input for listUsers
hooks.useQuery('listUsers');
// @ts-expect-error wrong input shape
hooks.useQuery('listUsers', { search: 42 });
// @ts-expect-error mutation input requires name
mutation.mutate({});
