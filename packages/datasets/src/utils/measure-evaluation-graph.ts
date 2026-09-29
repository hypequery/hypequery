import type { DatasetMeasureDefinition, DerivedMeasureDefinition, MeasureTimeInterval } from '../types.js';
import { isDerivedMeasure, isShiftMeasure } from './dataset-measures.js';

export interface MeasureEvaluationContext { id: number; parent?: number; interval?: MeasureTimeInterval }
export interface MeasureEvaluationNode {
  id: number;
  name: string;
  context: number;
  definition: DatasetMeasureDefinition;
  inputs?: Record<string, number>;
}

/** A shift changes evaluation context; formulas combine values in that context. */
export function buildMeasureEvaluationGraph(measures: Readonly<Record<string, DatasetMeasureDefinition>>, selected: readonly string[]) {
  const contexts: MeasureEvaluationContext[] = [{ id: 0 }];
  const nodes: MeasureEvaluationNode[] = [];
  const memo = new Map<string, number>();
  const contextMemo = new Map<string, number>();
  const visit = (name: string, context: number): number => {
    const key = `${context}:${name}`;
    const existing = memo.get(key);
    if (existing !== undefined) return existing;
    const definition = measures[name];
    if (isShiftMeasure(definition)) {
      const contextKey = `${context}:${definition.interval.amount}:${definition.interval.unit}`;
      let shifted = contextMemo.get(contextKey);
      if (shifted === undefined) {
        shifted = contexts.length;
        contexts.push({ id: shifted, parent: context, interval: definition.interval });
        contextMemo.set(contextKey, shifted);
      }
      const input = visit(definition.measure, shifted);
      memo.set(key, input);
      return input;
    }
    const inputs = isDerivedMeasure(definition)
      ? Object.fromEntries(Object.entries(definition.uses).map(([alias, input]) => [alias, visit(input, context)])) : undefined;
    const id = nodes.length;
    nodes.push({ id, name, context, definition, inputs });
    memo.set(key, id);
    return id;
  };
  const outputs = Object.fromEntries(selected.map(name => [name, visit(name, 0)]));
  return { contexts, nodes, outputs };
}

export function evaluationFormula(node: MeasureEvaluationNode): DerivedMeasureDefinition {
  return { ...(node.definition as DerivedMeasureDefinition), uses: Object.fromEntries(
    Object.entries(node.inputs ?? {}).map(([alias, id]) => [alias, `_hq_value${id}`]),
  ) };
}
