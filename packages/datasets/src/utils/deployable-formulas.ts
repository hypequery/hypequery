/**
 * The subset of derived-measure formulas a deployment contract accepts.
 *
 * Local planning accepts every formula the helpers can build. The RFC 0006
 * deployment grammar is narrower: a derived measure may reference only base
 * measures, and a literal may appear only as `round` decimals or as a
 * `coalesce` fallback. Checking that subset against the definition, rather
 * than the emitted contract, lets the failure name the dataset and measure
 * instead of a JSON path such as `$.datasets[2].measures[19].expression.right`.
 */

import type { SemanticExpression } from '../semantic-plan.js';
import type { AnyDatasetInstance, DatasetMeasureDefinition, DerivedMeasureDefinition } from '../types.js';
import { isDerivedMeasure, splitDatasetMeasures } from './dataset-measures.js';

const LITERAL_POSITIONS = 'literals are only accepted as round decimals or a coalesce fallback';

function literalIssue(expression: SemanticExpression, where: string): string | undefined {
  if (expression.kind !== 'literal') return undefined;
  return `a numeric literal cannot be ${where} in a deployable formula; ${LITERAL_POSITIONS}`;
}

/** Why `expression` cannot be deployed, or `undefined` when it can. */
function expressionIssue(expression: SemanticExpression): string | undefined {
  switch (expression.kind) {
    case 'ref':
      return undefined;
    case 'literal':
      return `a literal cannot be a deployable formula on its own; ${LITERAL_POSITIONS}`;
    case 'binary':
      for (const operand of [expression.left, expression.right]) {
        const issue = literalIssue(operand, 'an arithmetic operand') ?? expressionIssue(operand);
        if (issue !== undefined) return issue;
      }
      return undefined;
    case 'function': {
      const [first, second] = expression.args;
      if (first === undefined) return undefined;
      const issue = literalIssue(first, `the value passed to ${expression.name}`) ?? expressionIssue(first);
      if (issue !== undefined || second === undefined) return issue;
      if (expression.name === 'round') {
        return second.kind === 'literal' && typeof second.value === 'number'
          ? undefined
          : 'round decimals must be a numeric literal in a deployable formula';
      }
      if (expression.name === 'coalesce' && second.kind === 'literal') {
        return typeof second.value === 'number'
          ? undefined
          : 'a coalesce fallback must be a number in a deployable formula; null, booleans and strings are not accepted';
      }
      return expressionIssue(second);
    }
    default:
      return 'formula contains an unsupported expression kind';
  }
}

/**
 * Why `definition` cannot be deployed, or `undefined` when it can.
 *
 * `measures` are the measures of the dataset that owns the definition. The
 * dataset has already validated references, aliases and cycles, so only the
 * deployment-specific restrictions are reported here.
 */
export function deployableFormulaIssue(
  definition: DerivedMeasureDefinition,
  measures: Readonly<Record<string, DatasetMeasureDefinition>>,
): string | undefined {
  // Window and shift inputs are refused by the contract adapter itself, with
  // the contract version as the reason; only a derived input is reported here.
  for (const [alias, measureName] of Object.entries(definition.uses)) {
    const input = Object.hasOwn(measures, measureName) ? measures[measureName] : undefined;
    if (!isDerivedMeasure(input)) continue;
    const spelled = alias === measureName ? `"${measureName}"` : `"${measureName}" (as "${alias}")`;
    return `references derived measure ${spelled}; a deployable formula may only reference base measures, `
      + 'so inline that formula or reference the base measures directly';
  }
  const aliases = Object.fromEntries(Object.keys(definition.uses).map(alias => [alias, alias]));
  return expressionIssue(definition.formula(aliases).expression);
}

/** Every `[measure name, issue]` pair among a dataset's derived measures, in definition order. */
export function deployableMeasureIssues(
  measures: Readonly<Record<string, DatasetMeasureDefinition>> | undefined,
): Array<[string, string]> {
  const issues: Array<[string, string]> = [];
  for (const [name, definition] of Object.entries(splitDatasetMeasures(measures).derived)) {
    const issue = deployableFormulaIssue(definition, measures ?? {});
    if (issue !== undefined) issues.push([name, issue]);
  }
  return issues;
}

/**
 * Refuse a dataset whose derived measures the deployment contract cannot carry.
 *
 * Local queries accept every formula the helpers build. A deployment contract
 * accepts a narrower subset: derived measures may reference only base measures,
 * and a literal may appear only as `round` decimals or as a `coalesce`
 * fallback. `buildProtocolDeploymentContract` (and so `hypequery deploy`) runs
 * this check first, so the error names the dataset and measure
 * (`orders.doubled: ...`) instead of a contract path.
 */
export function assertDeployable(dataset: AnyDatasetInstance): void {
  const [first] = deployableMeasureIssues(dataset.measures);
  if (first !== undefined) {
    const [name, issue] = first;
    throw new Error(`${dataset.name}.${name}: ${issue}`);
  }
}
