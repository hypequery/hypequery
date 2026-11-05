/**
 * What a table's ClickHouse engine says about how to read its rows.
 *
 * Mirrors Cloud's onboarding `parseEngineMetadata`
 * (apps/web/src/lib/clickhouse/engine-metadata.ts), so the CLI and onboarding
 * read the same engine semantics from `system.tables`. Distributed and
 * materialized-view details are left out: the dataset scaffold doesn't use them.
 */
export interface EngineMetadata {
  /** The engine without its `Replicated`/`Shared` prefix, e.g. `ReplacingMergeTree`. */
  readonly family: string;
  readonly versionColumn?: string;
  readonly deletedColumn?: string;
  readonly signColumn?: string;
  readonly summingColumns?: readonly string[];
  /**
   * Columns the sorting key reads, from `system.tables.sorting_key` (CLI only;
   * not part of Cloud's parser). SummingMergeTree never sums these.
   */
  readonly sortingKeyColumns?: readonly string[];
}

/**
 * Every column a `system.tables.sorting_key` expression reads, so a column
 * inside a key expression (`toDate(created_at)`) also counts. String literals
 * (`'amount'`) and function names are not columns and are skipped.
 */
export function sortingKeyColumns(sortingKey: string): string[] {
  const names = new Set<string>();
  const tokens = /'(?:[^'\\]|\\.|'')*'|`((?:[^`]|``)+)`|\b([A-Za-z_][A-Za-z0-9_]*)\b(?!\s*\()/g;
  for (const match of sortingKey.matchAll(tokens)) {
    if (match[1] !== undefined) names.add(match[1].replaceAll('``', '`'));
    else if (match[2] !== undefined) names.add(match[2]);
  }
  return [...names];
}

/** Splits engine arguments without splitting tuples, functions or quoted commas. */
function splitArguments(text: string): string[] | undefined {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) {
        if (text[i + 1] === quote) i++;
        else quote = '';
      }
    } else if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '(') depth++;
    else if (c === ')') {
      if (--depth < 0) return undefined;
    } else if (c === ',' && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (depth || quote) return undefined;
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}

function identifier(value: string | undefined): string | undefined {
  if (!value) return undefined;
  // Engine columns are identifiers, never string literals or expressions.
  const plain = value.replace(/^`((?:[^`]|``)+)`$/, (_, name: string) => name.replaceAll('``', '`'));
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(plain) ? plain : undefined;
}

/**
 * Parses modern engine syntax only (`engine` and `engine_full` from
 * `system.tables`). Unknown or deprecated signatures keep their family but
 * never acquire guessed column semantics. Replicated and Shared engines may
 * carry a ZooKeeper path and replica name first, or omit them for defaults.
 */
export function parseEngineMetadata(engine: string, engineFull: string): EngineMetadata {
  const family = engine.replace(/^(?:Replicated|Shared)/, '');
  const result: EngineMetadata = { family };
  const prefix = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*/.exec(engineFull);
  if (!prefix || prefix[1] !== engine) return result;
  const rest = engineFull.slice(prefix[0].length);
  if (!rest.startsWith('(')) return result;
  // Find the matching close without confusing parentheses in strings.
  let depth = 0;
  let quote = '';
  let end = -1;
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i]!;
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) {
        if (rest[i + 1] === quote) i++;
        else quote = '';
      }
    } else if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) {
      end = i;
      break;
    }
  }
  if (end < 0) return result;
  let args = splitArguments(rest.slice(1, end));
  if (!args) return result;
  if (/^(?:Replicated|Shared)/.test(engine) && args[0]?.startsWith("'")) {
    if (!args[1]?.startsWith("'")) return result;
    args = args.slice(2);
  }
  switch (family) {
    case 'ReplacingMergeTree': {
      if (args.length > 2) return result;
      const versionColumn = identifier(args[0]);
      const deletedColumn = identifier(args[1]);
      return {
        ...result,
        ...(versionColumn ? { versionColumn } : {}),
        ...(versionColumn && deletedColumn ? { deletedColumn } : {}),
      };
    }
    case 'CollapsingMergeTree':
    case 'VersionedCollapsingMergeTree': {
      if (args.length !== (family === 'CollapsingMergeTree' ? 1 : 2)) return result;
      const signColumn = identifier(args[0]);
      const versionColumn = identifier(args[1]);
      return {
        ...result,
        ...(signColumn ? { signColumn } : {}),
        ...(versionColumn ? { versionColumn } : {}),
      };
    }
    case 'SummingMergeTree': {
      if (args.length !== 1) return result;
      const arg = args[0]!;
      const columns = splitArguments(arg.startsWith('(') && arg.endsWith(')') ? arg.slice(1, -1) : arg);
      const names = columns?.map(identifier);
      return names?.every((name): name is string => name !== undefined)
        ? { ...result, summingColumns: names }
        : result;
    }
    default:
      return result;
  }
}
