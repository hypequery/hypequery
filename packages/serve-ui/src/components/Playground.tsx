import { useState, useEffect, useCallback } from 'react';
import { Play, Loader2, AlertCircle, CheckCircle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiClient } from '@/lib/api-client';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';

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

interface PlaygroundQuery {
  key: string;
  path: string;
  method: string;
  description?: string;
  tags: string[];
  inputSchema: JsonSchema | null;
  outputSchema: JsonSchema | null;
}

interface ExecutionResult {
  success: boolean;
  queryKey: string;
  result?: unknown;
  error?: string;
  duration: number;
  timestamp: number;
}

interface PlaygroundProps {
  className?: string;
}

/**
 * Query Playground component for testing API endpoints.
 */
export function Playground({ className }: PlaygroundProps) {
  const [queries, setQueries] = useState<PlaygroundQuery[]>([]);
  const [selectedQuery, setSelectedQuery] = useState<PlaygroundQuery | null>(null);
  const [inputValues, setInputValues] = useState<Record<string, unknown>>({});
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch available queries
  useEffect(() => {
    async function fetchQueries() {
      try {
        setLoading(true);
        const response = await apiClient.getPlaygroundQueries();
        // Cast to our internal PlaygroundQuery type with proper schema types
        const typedQueries = response.queries as PlaygroundQuery[];
        setQueries(typedQueries);
        if (typedQueries.length > 0 && !selectedQuery) {
          setSelectedQuery(typedQueries[0]);
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }

    fetchQueries();
  }, []);

  // Reset input values when query changes
  useEffect(() => {
    if (selectedQuery?.inputSchema) {
      const defaults = getDefaultValues(selectedQuery.inputSchema);
      setInputValues(defaults);
    } else {
      setInputValues({});
    }
    setResult(null);
  }, [selectedQuery?.key]);

  // Execute query
  const executeQuery = useCallback(async () => {
    if (!selectedQuery) return;

    setExecuting(true);
    setResult(null);

    try {
      const response = await apiClient.executePlaygroundQuery(
        selectedQuery.key,
        Object.keys(inputValues).length > 0 ? inputValues : undefined
      );
      setResult(response);
    } catch (err) {
      setResult({
        success: false,
        queryKey: selectedQuery.key,
        error: (err as Error).message,
        duration: 0,
        timestamp: Date.now()
      });
    } finally {
      setExecuting(false);
    }
  }, [selectedQuery, inputValues]);

  if (loading) {
    return (
      <div className={cn('flex items-center justify-center h-full', className)}>
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn('flex items-center justify-center h-full', className)}>
        <div className="text-center">
          <AlertCircle className="h-12 w-12 mx-auto text-destructive mb-4" />
          <p className="text-destructive">{error}</p>
        </div>
      </div>
    );
  }

  if (queries.length === 0) {
    return (
      <div className={cn('flex items-center justify-center h-full', className)}>
        <div className="text-center text-muted-foreground">
          <Play className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>No queries available</p>
          <p className="text-sm mt-2">Add queries to your API to use the playground</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('h-full flex', className)}>
      {/* Query Selector Sidebar */}
      <div className="w-64 flex-shrink-0 border-r border-border overflow-auto">
        <div className="p-4">
          <h3 className="text-sm font-medium mb-3">Available Queries</h3>
          <div className="space-y-1">
            {queries.map((query) => (
              <button
                key={query.key}
                onClick={() => setSelectedQuery(query)}
                className={cn(
                  'w-full text-left px-3 py-2 rounded-md text-sm transition-colors',
                  selectedQuery?.key === query.key
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted'
                )}
              >
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {query.method}
                  </Badge>
                  <span className="truncate">{query.key}</span>
                </div>
                {query.description && (
                  <p className="text-xs mt-1 opacity-70 truncate">
                    {query.description}
                  </p>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-6">
        {selectedQuery ? (
          <div className="max-w-3xl space-y-6">
            {/* Query Info */}
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h2 className="text-xl font-semibold">{selectedQuery.key}</h2>
                <Badge variant="outline">{selectedQuery.method}</Badge>
              </div>
              {selectedQuery.description && (
                <p className="text-muted-foreground">{selectedQuery.description}</p>
              )}
              <p className="text-sm text-muted-foreground mt-1">
                Path: <code className="bg-muted px-1 rounded">{selectedQuery.path}</code>
              </p>
              {selectedQuery.tags.length > 0 && (
                <div className="flex gap-1 mt-2">
                  {selectedQuery.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* Input Form */}
            {selectedQuery.inputSchema && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Input Parameters</CardTitle>
                  <CardDescription>
                    Configure the query input
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <SchemaForm
                    schema={selectedQuery.inputSchema}
                    values={inputValues}
                    onChange={setInputValues}
                  />
                </CardContent>
              </Card>
            )}

            {/* Execute Button */}
            <Button
              onClick={executeQuery}
              disabled={executing}
              className="w-full"
              size="lg"
            >
              {executing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Executing...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Execute Query
                </>
              )}
            </Button>

            {/* Result */}
            {result && (
              <Card className={result.success ? 'border-green-200 dark:border-green-800' : 'border-red-200 dark:border-red-800'}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {result.success ? (
                        <CheckCircle className="h-5 w-5 text-green-500" />
                      ) : (
                        <AlertCircle className="h-5 w-5 text-red-500" />
                      )}
                      <CardTitle className="text-base">
                        {result.success ? 'Success' : 'Error'}
                      </CardTitle>
                    </div>
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                      <Clock className="h-4 w-4" />
                      {result.duration}ms
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {result.success ? (
                    <div className="bg-muted rounded-md p-4 overflow-auto max-h-96">
                      <pre className="text-sm font-mono whitespace-pre-wrap">
                        {JSON.stringify(result.result, null, 2)}
                      </pre>
                    </div>
                  ) : (
                    <div className="bg-red-50 dark:bg-red-900/20 rounded-md p-4">
                      <p className="text-red-700 dark:text-red-400">
                        {result.error}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            Select a query to get started
          </div>
        )}
      </div>
    </div>
  );
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
 * Dynamic form generated from JSON schema.
 */
function SchemaForm({
  schema,
  values,
  onChange
}: {
  schema: JsonSchema;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
}) {
  if (schema.type !== 'object' || !schema.properties) {
    return (
      <div className="text-sm text-muted-foreground">
        Schema type "{schema.type}" not supported for form generation
      </div>
    );
  }

  const updateValue = (key: string, value: unknown) => {
    onChange({ ...values, [key]: value });
  };

  return (
    <div className="space-y-4">
      {Object.entries(schema.properties).map(([key, prop]) => {
        const isRequired = schema.required?.includes(key);
        const value = values[key];

        return (
          <div key={key}>
            <label className="block text-sm font-medium mb-1.5">
              {key}
              {isRequired && <span className="text-destructive ml-1">*</span>}
            </label>
            {prop.description && (
              <p className="text-xs text-muted-foreground mb-1.5">
                {prop.description}
              </p>
            )}
            <FieldInput
              schema={prop}
              value={value}
              onChange={(v) => updateValue(key, v)}
            />
          </div>
        );
      })}
    </div>
  );
}

/**
 * Individual field input based on schema type.
 */
function FieldInput({
  schema,
  value,
  onChange
}: {
  schema: JsonSchema;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  // Enum dropdown
  if (schema.enum) {
    return (
      <select
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
      >
        <option value="">Select...</option>
        {schema.enum.map((opt) => (
          <option key={String(opt)} value={String(opt)}>
            {String(opt)}
          </option>
        ))}
      </select>
    );
  }

  // Boolean checkbox
  if (schema.type === 'boolean') {
    return (
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 rounded border-input"
        />
        <span className="text-sm">Enabled</span>
      </label>
    );
  }

  // Number input
  if (schema.type === 'number' || schema.type === 'integer') {
    return (
      <Input
        type="number"
        value={value as number ?? ''}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
        min={schema.minimum}
        max={schema.maximum}
        step={schema.type === 'integer' ? 1 : 'any'}
      />
    );
  }

  // Array input (JSON)
  if (schema.type === 'array') {
    return (
      <textarea
        value={typeof value === 'string' ? value : JSON.stringify(value ?? [], null, 2)}
        onChange={(e) => {
          try {
            onChange(JSON.parse(e.target.value));
          } catch {
            // Keep as string if not valid JSON
          }
        }}
        className="w-full min-h-[80px] px-3 py-2 rounded-md border border-input bg-background text-sm font-mono"
        placeholder="[]"
      />
    );
  }

  // Object input (JSON)
  if (schema.type === 'object' && !schema.properties) {
    return (
      <textarea
        value={typeof value === 'string' ? value : JSON.stringify(value ?? {}, null, 2)}
        onChange={(e) => {
          try {
            onChange(JSON.parse(e.target.value));
          } catch {
            // Keep as string if not valid JSON
          }
        }}
        className="w-full min-h-[80px] px-3 py-2 rounded-md border border-input bg-background text-sm font-mono"
        placeholder="{}"
      />
    );
  }

  // Default: string input
  return (
    <Input
      type="text"
      value={String(value ?? '')}
      onChange={(e) => onChange(e.target.value || undefined)}
      minLength={schema.minLength}
      maxLength={schema.maxLength}
      placeholder={schema.default !== undefined ? String(schema.default) : undefined}
    />
  );
}

export default Playground;
