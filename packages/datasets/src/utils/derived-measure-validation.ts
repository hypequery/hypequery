import type {
  DatasetMeasureDefinition,
  DerivedMeasureDefinition,
  FormulaExpr,
  MeasureDefinition,
} from '../types.js';
import type { SemanticExpression } from '../semantic-plan.js';
import { isSafeSQLIdentifier } from '../sql-utils.js';
import { isBaseMeasure, isDerivedMeasure } from './dataset-measures.js';

function fail(datasetName: string, measureName: string, detail: string): never {
  throw new Error(`Invalid dataset "${datasetName}": derived measure "${measureName}" ${detail}`);
}

const BINARY_OPERATORS = new Set(['add', 'subtract', 'multiply', 'divide']);
const FUNCTION_ARITIES: Readonly<Record<string, readonly number[]>> = {
  nullIfZero: [1],
  coalesce: [2],
  round: [2],
  floor: [1],
  ceil: [1],
};

function collectReferences(
  datasetName: string,
  measureName: string,
  expression: SemanticExpression,
  references: Set<string>,
  budget: { nodes: number },
  depth = 0,
): void {
  budget.nodes += 1;
  if (depth > 16 || budget.nodes > 256) {
    fail(datasetName, measureName, 'formula exceeds the expression limits.');
  }
  if (typeof expression !== 'object' || expression === null) {
    fail(datasetName, measureName, 'formula contains an invalid expression.');
  }
  switch (expression.kind) {
    case 'ref':
      if (typeof expression.name !== 'string' || !isSafeSQLIdentifier(expression.name)) {
        fail(datasetName, measureName, 'formula contains an invalid input reference.');
      }
      references.add(expression.name);
      return;
    case 'literal':
      if (expression.value !== null
        && typeof expression.value !== 'string'
        && typeof expression.value !== 'boolean'
        && (typeof expression.value !== 'number' || !Number.isFinite(expression.value))) {
        fail(datasetName, measureName, 'formula contains an invalid literal.');
      }
      return;
    case 'binary':
      if (!BINARY_OPERATORS.has(expression.operator)) {
        fail(datasetName, measureName, 'formula contains an unsupported binary operator.');
      }
      collectReferences(datasetName, measureName, expression.left, references, budget, depth + 1);
      collectReferences(datasetName, measureName, expression.right, references, budget, depth + 1);
      return;
    case 'function':
      if (!Array.isArray(expression.args)
        || !FUNCTION_ARITIES[expression.name]?.includes(expression.args.length)) {
        fail(datasetName, measureName, 'formula contains an unsupported function or arity.');
      }
      expression.args.forEach(argument => collectReferences(
        datasetName, measureName, argument, references, budget, depth + 1,
      ));
      return;
    default:
      fail(datasetName, measureName, 'formula contains an unsupported expression kind.');
  }
}

function evaluateFormula(
  datasetName: string,
  measureName: string,
  definition: DerivedMeasureDefinition,
): FormulaExpr {
  const aliases = Object.keys(definition.uses);
  let formula: FormulaExpr;
  try {
    formula = definition.formula(Object.fromEntries(aliases.map(alias => [alias, alias])));
  } catch (error) {
    fail(datasetName, measureName, `formula threw: ${error instanceof Error ? error.message : String(error)}.`);
  }
  if (
    typeof formula !== 'object'
    || formula === null
    || formula.__type !== 'formula_expr'
    || typeof formula.toSQL !== 'function'
    || typeof formula.expression !== 'object'
    || formula.expression === null
  ) {
    fail(datasetName, measureName, 'formula must return a FormulaExpr.');
  }
  return formula;
}

function assertAcyclic(
  datasetName: string,
  derivedMeasures: Record<string, DerivedMeasureDefinition>,
): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (name: string): void => {
    if (visiting.has(name)) fail(datasetName, name, 'contains a dependency cycle.');
    if (visited.has(name)) return;
    if (!Object.hasOwn(derivedMeasures, name)) return;
    const definition = derivedMeasures[name];
    visiting.add(name);
    Object.values(definition.uses).forEach(dependency => visit(dependency));
    visiting.delete(name);
    visited.add(name);
  };

  Object.keys(derivedMeasures).forEach(visit);
}

export function validateDerivedMeasures(
  datasetName: string,
  measures: Record<string, DatasetMeasureDefinition>,
): void {
  const baseMeasures = Object.fromEntries(
    Object.entries(measures).filter(([, definition]) => definition && isBaseMeasure(definition)),
  ) as Record<string, MeasureDefinition>;
  const derivedMeasures = Object.fromEntries(
    Object.entries(measures).filter(([, definition]) => definition && isDerivedMeasure(definition)),
  ) as Record<string, DerivedMeasureDefinition>;
  for (const [measureName, definition] of Object.entries(derivedMeasures)) {
    if (!isSafeSQLIdentifier(measureName)) {
      fail(datasetName, measureName, 'name is not a safe identifier.');
    }
    if (typeof definition !== 'object' || definition === null || definition.__type !== 'derived_measure_definition') {
      fail(datasetName, measureName, 'must be created with measure.derived().');
    }
    if (typeof definition.uses !== 'object' || definition.uses === null || Array.isArray(definition.uses)) {
      fail(datasetName, measureName, 'must declare an input map.');
    }
  }
  assertAcyclic(datasetName, derivedMeasures);

  for (const [measureName, definition] of Object.entries(derivedMeasures)) {
    const uses = Object.entries(definition.uses);
    if (uses.length === 0) fail(datasetName, measureName, 'must reference at least one base measure.');
    if (typeof definition.formula !== 'function') fail(datasetName, measureName, 'must define a formula function.');

    for (const [alias, dependencyName] of uses) {
      if (!isSafeSQLIdentifier(alias)) fail(datasetName, measureName, `has invalid input alias "${alias}".`);
      if (typeof dependencyName !== 'string' || dependencyName.includes('.')) {
        fail(datasetName, measureName, `references cross-dataset measure "${String(dependencyName)}".`);
      }
      if (Object.hasOwn(derivedMeasures, dependencyName)) {
        fail(datasetName, measureName, `references derived measure "${dependencyName}"; v1 inputs must be base measures.`);
      }
      if (!Object.hasOwn(baseMeasures, dependencyName)) fail(datasetName, measureName, `references missing measure "${dependencyName}".`);
    }

    const references = new Set<string>();
    collectReferences(
      datasetName, measureName,
      evaluateFormula(datasetName, measureName, definition).expression,
      references, { nodes: 0 },
    );
    for (const reference of references) {
      if (!Object.hasOwn(definition.uses, reference)) {
        fail(datasetName, measureName, `formula references undeclared input alias "${reference}".`);
      }
    }
    for (const [alias] of uses) {
      if (!references.has(alias)) {
        fail(datasetName, measureName, `declares unused input alias "${alias}".`);
      }
    }
  }
}
