import { collectSetupState, type CollectOptions } from '../utils/setup-state/collect.js';
import { chooseNextStep, renderNextStep, type NextStep } from '../utils/setup-state/next-step.js';
import { emitResult } from '../utils/machine-output.js';

/**
 * `hypequery next`: where this project is in onboarding and the one step that
 * is due, written for a coding agent: what to run, what to ask the person,
 * and what never to do (such as ask for the database password in chat).
 * Never prompts and never changes anything.
 */
export async function nextCommand(dependencies: CollectOptions = {}): Promise<NextStep> {
  const state = await collectSetupState({ probe: true, ...dependencies });
  const next = chooseNextStep(state);
  console.log(renderNextStep(next));
  emitResult(next);
  return next;
}
