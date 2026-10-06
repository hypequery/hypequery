#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

pnpm --dir "$ROOT_DIR" exec turbo run build --filter=@hypequery/clickhouse >/dev/null
(
  cd "$ROOT_DIR/packages/clickhouse"
  npm pack --silent --ignore-scripts --pack-destination "$WORKDIR" >/dev/null
)

cat > "$WORKDIR/package.json" <<'JSON'
{ "private": true, "type": "module" }
JSON

(
  cd "$WORKDIR"
  # Keep declarations independent of workspace links; provide the optional web
  # peer so its absence cannot mask a Node ESM declaration resolution failure.
  npm install --ignore-scripts --no-package-lock ./hypequery-clickhouse-*.tgz \
    @clickhouse/client-web@1.23.1 @types/node@18.19.80 >/dev/null
)

cat > "$WORKDIR/tsconfig.json" <<'JSON'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": false,
    "noEmit": true,
    "types": ["node"],
    "lib": ["ES2022", "ESNext.Disposable"]
  },
  "include": ["consumer.ts"]
}
JSON

cat > "$WORKDIR/consumer.ts" <<'TS'
import { createQueryBuilder, generateTypes } from '@hypequery/clickhouse';
import {
  clickhouseToTsType,
  generateTypeDefinitions,
  generateTypes as cliGenerateTypes,
  type GenerateTypesOptions,
  type TypeGenerationClickHouseClient,
} from '@hypequery/clickhouse/cli';

const db = createQueryBuilder<{ events: { id: 'UInt32' } }>({ host: 'http://localhost:8123' });
const selected = db.table('events').select(['id']);
const rootGenerator: (path: string, options?: GenerateTypesOptions) => Promise<void> = generateTypes;
const cliGenerator: typeof rootGenerator = cliGenerateTypes;
const converter: (type: string) => string = clickhouseToTsType;
const definitionGenerator: (client: TypeGenerationClickHouseClient, options?: GenerateTypesOptions) => Promise<string> = generateTypeDefinitions;
void [selected, rootGenerator, cliGenerator, converter, definitionGenerator];

// This must retain its real signature rather than silently becoming any.
// @ts-expect-error the output path is a string
void generateTypes(123);
// @ts-expect-error the CLI entry point must retain the same signature
void cliGenerateTypes(123);
TS

node "$ROOT_DIR/node_modules/typescript/bin/tsc" --project "$WORKDIR/tsconfig.json"
node "$ROOT_DIR/node_modules/typescript/bin/tsc" --project "$WORKDIR/tsconfig.json" \
  --module Node16 --moduleResolution Node16

echo 'ClickHouse packed NodeNext / Node16 consumer smoke passed'
