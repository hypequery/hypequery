import { useState, useEffect, useCallback, useMemo } from 'react';
import { apiClient } from '@/lib/api-client';

interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  description?: string;
  default?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
}

export interface PlaygroundQuery {
  key: string;
  path: string;
  method: string;
  description?: string;
  tags: string[];
  inputSchema: JsonSchema | null;
  outputSchema: JsonSchema | null;
}

export interface ExecutionResult {
  success: boolean;
  queryKey: string;
  result?: unknown;
  error?: string;
  duration: number;
  timestamp: number;
}

interface PlaygroundState {
  queries: PlaygroundQuery[];
  selectedQuery: PlaygroundQuery | null;
  loading: boolean;
  error: string | null;
}

/**
 * Get default values from a JSON schema.
 */
function getDefaultValues(schema: JsonSchema): Record<string, unknown> {
  const values: Record<string, unknown> = {};

  if (schema.type === 'object' && schema.properties) {
    for (const [key, prop] of Object.entries(schema.properties)) {
      if (prop.default !== undefined) {
        values[key] = prop.default;
      } else if (prop.type === 'string') {
        values[key] = '';
      } else if (prop.type === 'number' || prop.type === 'integer') {
        values[key] = prop.minimum ?? 0;
      } else if (prop.type === 'boolean') {
        values[key] = false;
      } else if (prop.type === 'array') {
        values[key] = [];
      } else if (prop.type === 'object') {
        values[key] = getDefaultValues(prop);
      }
    }
  }

  return values;
}

/**
 * Hook for managing playground queries list and selection.
 */
export function usePlaygroundQueries() {
  const [state, setState] = useState<PlaygroundState>({
    queries: [],
    selectedQuery: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    async function fetchQueries() {
      try {
        setState(s => ({ ...s, loading: true, error: null }));
        const response = await apiClient.getPlaygroundQueries();
        const typedQueries = response.queries as PlaygroundQuery[];
        setState(s => ({
          ...s,
          queries: typedQueries,
          selectedQuery: typedQueries.length > 0 ? typedQueries[0] : null,
          loading: false,
        }));
      } catch (err) {
        setState(s => ({
          ...s,
          error: (err as Error).message,
          loading: false,
        }));
      }
    }

    fetchQueries();
  }, []);

  const selectQuery = useCallback((query: PlaygroundQuery) => {
    setState(s => ({ ...s, selectedQuery: query }));
  }, []);

  return {
    ...state,
    selectQuery,
  };
}

interface ExecutionState {
  inputValues: Record<string, unknown>;
  executing: boolean;
  result: ExecutionResult | null;
}

/**
 * Hook for managing query execution state.
 */
export function useQueryExecution(selectedQuery: PlaygroundQuery | null) {
  const [state, setState] = useState<ExecutionState>({
    inputValues: {},
    executing: false,
    result: null,
  });

  // Reset input values when query changes
  useEffect(() => {
    if (selectedQuery?.inputSchema) {
      const defaults = getDefaultValues(selectedQuery.inputSchema);
      setState({ inputValues: defaults, executing: false, result: null });
    } else {
      setState({ inputValues: {}, executing: false, result: null });
    }
  }, [selectedQuery?.key]);

  const setInputValues = useCallback((values: Record<string, unknown>) => {
    setState(s => ({ ...s, inputValues: values }));
  }, []);

  const execute = useCallback(async () => {
    if (!selectedQuery) return;

    setState(s => ({ ...s, executing: true, result: null }));

    try {
      const response = await apiClient.executePlaygroundQuery(
        selectedQuery.key,
        Object.keys(state.inputValues).length > 0 ? state.inputValues : undefined
      );
      setState(s => ({ ...s, executing: false, result: response }));
    } catch (err) {
      setState(s => ({
        ...s,
        executing: false,
        result: {
          success: false,
          queryKey: selectedQuery.key,
          error: (err as Error).message,
          duration: 0,
          timestamp: Date.now(),
        },
      }));
    }
  }, [selectedQuery, state.inputValues]);

  return {
    ...state,
    setInputValues,
    execute,
  };
}

/**
 * Combined hook for the entire playground.
 */
export function usePlayground() {
  const queriesState = usePlaygroundQueries();
  const executionState = useQueryExecution(queriesState.selectedQuery);

  return useMemo(() => ({
    // Query list state
    queries: queriesState.queries,
    selectedQuery: queriesState.selectedQuery,
    loading: queriesState.loading,
    error: queriesState.error,
    selectQuery: queriesState.selectQuery,

    // Execution state
    inputValues: executionState.inputValues,
    executing: executionState.executing,
    result: executionState.result,
    setInputValues: executionState.setInputValues,
    execute: executionState.execute,
  }), [queriesState, executionState]);
}
