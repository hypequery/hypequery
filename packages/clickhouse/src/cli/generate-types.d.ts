/**
 * Minimal ClickHouse client surface needed by the type generator.
 */
export interface TypeGenerationClickHouseClient {
  query(options: { query: string; format: 'JSONEachRow' }): Promise<{
    json(): Promise<Array<Record<string, string>>>;
  }>;
}

/**
 * Options for generating TypeScript type definitions from ClickHouse.
 */
export interface GenerateTypesOptions {
  includeTables?: string[];
  excludeTables?: string[];
  client?: TypeGenerationClickHouseClient;
  generatedBy?: string;
  includeUsageExample?: boolean;
}

/**
 * Converts a ClickHouse type string to a TypeScript type string.
 */
export declare function clickhouseToTsType(type: string): string;

/**
 * Generates TypeScript type definitions from the ClickHouse database schema
 * @param outputPath - The file path where the type definitions will be written
 * @param options - Options for type generation
 */
export declare function generateTypes(outputPath: string, options?: GenerateTypesOptions): Promise<void>;

/**
 * Generates TypeScript type definition contents from a ClickHouse client.
 */
export declare function generateTypeDefinitions(
  client: TypeGenerationClickHouseClient,
  options?: GenerateTypesOptions,
): Promise<string>;
