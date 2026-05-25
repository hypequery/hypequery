export interface ClickHouseTestConnectionConfig {
  host: string;
  user: string;
  password: string;
  database: string;
}

export interface ClickHouseTestData {
  test_table: Array<Record<string, unknown>>;
  users: Array<Record<string, unknown>>;
  orders: Array<Record<string, unknown>>;
}

export interface ComposeCommand {
  command: string;
  args: string[];
}

export interface CommandResult {
  code: number;
  stdout?: string;
  stderr?: string;
}

export const REPO_ROOT: string;
export const DEFAULT_COMPOSE_PATH: string;
export const DEFAULT_TEST_DATA_PATH: string;
export const CLICKHOUSE_CONTAINER_NAME: string;
export const TEST_CONNECTION_CONFIG: ClickHouseTestConnectionConfig;
export const TEST_DATA: ClickHouseTestData;

export function normalizeDateValue(value: unknown): unknown;
export function loadTestData(testDataPath?: string): ClickHouseTestData;
export function logIntegrationMessage(message: string): void;
export function runCommand(
  command: string,
  args: string[],
  options?: {
    cwd?: string;
    capture?: boolean;
    env?: NodeJS.ProcessEnv;
  },
): Promise<CommandResult>;
export function checkPortAvailability(port: number): Promise<boolean>;
export function findFreePort(): Promise<number>;
export function ensurePort(
  envVar: string,
  defaultPort: number,
  logger?: (message: string) => void,
): Promise<number>;
export function detectComposeCommand(): Promise<ComposeCommand>;
export function ensureDockerDaemon(): Promise<void>;
export function isContainerRunning(containerName?: string): Promise<boolean>;
export function startClickHouseContainer(options?: {
  compose?: ComposeCommand;
  composeFile?: string;
  logger?: (message: string) => void;
}): Promise<void>;
export function stopClickHouseContainer(options?: {
  compose?: ComposeCommand;
  composeFile?: string;
  logger?: (message: string) => void;
}): Promise<void>;
export function sleep(ms: number): Promise<void>;
export function waitForClickHouse(options?: {
  config?: ClickHouseTestConnectionConfig;
  maxAttempts?: number;
  retryDelayMs?: number;
  logger?: (message: string) => void;
}): Promise<void>;
export function runSql(
  sql: string,
  options?: {
    config?: ClickHouseTestConnectionConfig;
    includeDatabase?: boolean;
  },
): Promise<void>;
export function insertRows(
  table: string,
  rows: Array<Record<string, unknown>>,
  config?: ClickHouseTestConnectionConfig,
): Promise<void>;
export function seedClickHouseDatabase(options?: {
  config?: ClickHouseTestConnectionConfig;
  data?: ClickHouseTestData;
  logger?: (message: string) => void;
}): Promise<void>;
