import type { ProtocolDeploymentContract } from '@hypequery/protocol';
import { CliError } from '../cli-error.js';
import type { JoinKey } from './engine-types.js';

type Dataset = ProtocolDeploymentContract['datasets'][number];
type ResolveFieldColumn = (dataset: Dataset, field: string) => string | null;

/** A join to check: the many side (child) and the side it looks up (parent). */
export interface JoinToCheck {
  readonly child: JoinKey;
  readonly parent: JoinKey;
  /** `dataset.relationship` when the model declares it. */
  readonly relationship?: string;
}

/** `table.column`, where the table may itself be `database.table`. */
function joinKey(value: string, flag: string): JoinKey {
  const dot = value.lastIndexOf('.');
  if (dot <= 0 || dot === value.length - 1) {
    throw new CliError('INVALID_INPUT', `${flag} expects table.column=table.column; got "${value}".`, {
      hint: 'Pass --join orders.customer_id=customers.id (child key first).',
    });
  }
  return { table: value.slice(0, dot), column: value.slice(dot + 1) };
}

/** `--join orders.customer_id=customers.id,...`: child key first, then the key it references. */
export function parseJoinPairs(value: string | undefined): JoinToCheck[] {
  return (value ?? '').split(',').map(pair => pair.trim()).filter(Boolean).map((pair) => {
    const [child, parent, extra] = pair.split('=');
    if (!child || !parent || extra !== undefined) {
      throw new CliError('INVALID_INPUT', `--join expects table.column=table.column; got "${pair}".`, {
        hint: 'Pass --join orders.customer_id=customers.id (child key first).',
      });
    }
    return { child: joinKey(child.trim(), '--join'), parent: joinKey(parent.trim(), '--join') };
  });
}

/**
 * The joins a model declares, as physical key pairs. `belongsTo` reads from
 * the declaring dataset to its target; `hasOne` and `hasMany` the other way.
 * Relationships whose keys are derived (no single column) are left out.
 */
export function declaredJoins(contract: ProtocolDeploymentContract, resolveFieldColumn: ResolveFieldColumn): JoinToCheck[] {
  return contract.datasets.flatMap(dataset => dataset.relationships.flatMap((relationship): JoinToCheck[] => {
    const target = contract.datasets.find(item => item.name === relationship.target);
    const from = resolveFieldColumn(dataset, String(relationship.from));
    const to = target && resolveFieldColumn(target, String(relationship.to));
    if (!target || !from || !to) return [];
    const own = { table: dataset.source, column: from };
    const other = { table: target.source, column: to };
    const name = `${dataset.name}.${relationship.name}`;
    return relationship.kind === 'belongsTo'
      ? [{ child: own, parent: other, relationship: name }]
      : [{ child: other, parent: own, relationship: name }];
  }));
}
