import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

import openapiTS, { astToString } from "openapi-typescript";

const TEMPLATE_CLIENT = (clientName: string) =>
  [
    'import type { paths } from "./types";',
    '',
    'type FetchImpl = typeof fetch;',
    '',
    'type ExtractJsonResponse<T> = T extends { responses: infer Responses }',
    '  ? Responses extends Record<string, any>',
    '    ? Responses[200] extends { content: { "application/json": infer R } }',
    '      ? R',
    '      : Responses[201] extends { content: { "application/json": infer R } }',
    '        ? R',
    '        : unknown',
    '    : unknown',
    '  : unknown;',
    '',
    'type ExtractBody<T> = T extends { requestBody: { content: { "application/json": infer Body } } }',
    '  ? Body',
    '  : undefined;',
    '',
    'type ExtractQuery<T> = T extends { parameters: { query: infer Params } }',
    '  ? Params',
    '  : undefined;',
    '',
    'type RequestOptions<Path extends keyof paths, Method extends keyof paths[Path]> = {',
    '  path: Path;',
    '  method: Method;',
    '  query?: ExtractQuery<paths[Path][Method]>;',
    '  body?: ExtractBody<paths[Path][Method]>;',
    '  headers?: Record<string, string>;',
    '  fetch?: FetchImpl;',
    '} & Omit<RequestInit, "body" | "method">;',
    '',
    'interface ClientConfig {',
    '  baseUrl: string;',
    '  headers?: Record<string, string>;',
    '  fetch?: FetchImpl;',
    '}',
    '',
    'const encodeQueryValue = (value: unknown) =>',
    '  Array.isArray(value)',
    '    ? value.map((v) => encodeURIComponent(String(v))).join(",")',
    '    : encodeURIComponent(String(value));',
    '',
    'const buildUrl = (baseUrl: string, path: string, query?: Record<string, unknown>) => {',
    '  const url = new URL(path, baseUrl);',
    '',
    '  if (query) {',
    '    Object.entries(query).forEach(([key, value]) => {',
    '      if (value === undefined || value === null) {',
    '        return;',
    '      }',
    '',
    '      if (Array.isArray(value)) {',
    '        value.forEach((entry) => url.searchParams.append(key, String(entry)));',
    '      } else if (typeof value === "object") {',
    '        url.searchParams.append(key, encodeQueryValue(JSON.stringify(value)));',
    '      } else {',
    '        url.searchParams.append(key, encodeQueryValue(value));',
    '      }',
    '    });',
    '  }',
    '',
    '  return url;',
    '};',
    '',
    `export class ${clientName} {`,
    '  constructor(private readonly config: ClientConfig) {}',
    '',
    '  async request<Path extends keyof paths, Method extends keyof paths[Path]>(',
    '    options: RequestOptions<Path, Method>',
    '  ): Promise<ExtractJsonResponse<paths[Path][Method]>> {',
    '    const target = buildUrl(this.config.baseUrl, options.path as string, options.query);',
    '    const fetchImpl = options.fetch ?? this.config.fetch ?? globalThis.fetch;',
    '',
    '    if (!fetchImpl) {',
    '      throw new Error("No fetch implementation available. Provide one via config.fetch.");',
    '    }',
    '',
    '    const headers = {',
    '      "content-type": "application/json",',
    '      ...(this.config.headers ?? {}),',
    '      ...(options.headers ?? {}),',
    '    };',
    '',
    '    const response = await fetchImpl(target.toString(), {',
    '      ...options,',
    '      method: options.method as string,',
    '      headers,',
    '      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,',
    '    });',
    '',
    '    if (!response.ok) {',
    '      const errorText = await response.text();',
    '      throw new Error(`Request failed with status ${response.status}: ${errorText}`);',
    '    }',
    '',
    '    const text = await response.text();',
    '    if (!text) {',
    '      return undefined as ExtractJsonResponse<paths[Path][Method]>;',
    '    }',
    '',
    '    return JSON.parse(text);',
    '  }',
    '}',
    '',
    `export const createClient = (config: ClientConfig) => new ${clientName}(config);`,
    '',
  ].join("\n");

const TEMPLATE_INDEX = `export * from "./client";
export * from "./types";
`;

export interface GenerateSdkOptions {
  input: string;
  output: string;
  clientName?: string;
}

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value);

const loadDocument = async (input: string) => {
  if (isHttpUrl(input)) {
    const response = await fetch(input);
    if (!response.ok) {
      throw new Error(`Failed to fetch OpenAPI spec from ${input}: ${response.status}`);
    }
    return response.json();
  }

  const absolutePath = isAbsolute(input) ? input : resolve(process.cwd(), input);
  const contents = await readFile(absolutePath, "utf8");
  return JSON.parse(contents);
};

const writeFileSafe = async (filePath: string, contents: string) => {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, "utf8");
};

export const generateSdkClient = async (options: GenerateSdkOptions) => {
  const document = await loadDocument(options.input);
  const typesAst = await openapiTS(document, {
    exportType: true,
  });
  const types = astToString(typesAst);

  const outputDir = isAbsolute(options.output) ? options.output : resolve(process.cwd(), options.output);
  const clientName = options.clientName ?? "HypeQueryClient";

  await writeFileSafe(join(outputDir, "types.ts"), types);
  await writeFileSafe(join(outputDir, "client.ts"), TEMPLATE_CLIENT(clientName));
  await writeFileSafe(join(outputDir, "index.ts"), TEMPLATE_INDEX);
};
