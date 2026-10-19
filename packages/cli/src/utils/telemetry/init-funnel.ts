import { CommandExit } from '../command-exit.js';
import { isPromptCancelled } from '../prompts.js';
import { cancelCommandTelemetry, updateCommandTelemetry, type CommandMetrics } from './command-context.js';

type InitStage = NonNullable<CommandMetrics<'init'>['stage_reached']>;
const stages: readonly InitStage[] = ['started', 'database_selected', 'connection_tested', 'style_selected', 'files_written', 'dependencies_installed', 'completed'];

/** Tracks actual progress even when embedded setup tests its connection later. */
export class InitFunnel {
  private reached: InitStage = 'started';
  private attempted: InitStage = 'started';

  constructor(metrics: CommandMetrics<'init'>) {
    this.update({ ...metrics, stage_reached: this.reached });
  }

  update(metrics: CommandMetrics<'init'>): void { updateCommandTelemetry('init', metrics); }

  attempt(stage: InitStage): void { this.attempted = stage; }

  reach(stage: InitStage): void {
    if (stages.indexOf(stage) > stages.indexOf(this.reached)) this.reached = stage;
    this.update({ stage_reached: this.reached });
  }

  cancel(): void { cancelCommandTelemetry(); }

  fail(error: unknown): void {
    if (isPromptCancelled(error) || error instanceof CommandExit && error.outcome !== 'failure') return;
    this.update({ failed_stage: this.attempted });
  }
}
