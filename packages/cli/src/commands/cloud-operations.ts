import { Command, Option } from 'commander';
import { CLOUD_ERRORS, createCloudClient, isCloudApiError } from '@hypequery/cloud-client';
import { CLOUD_OPERATION_SPECS } from '../generated/cloud-operations.js';
import { CliError } from '../utils/cli-error.js';
import { getCliVersion } from '../utils/cli-version.js';
import type { CloudDeploymentAccessDependencies } from '../utils/cloud-deployment-access.js';
import { resolveCloudApiAccess } from '../utils/cloud-operations/api-access.js';
import { cliErrorFromCloud } from '../utils/cloud-operations/cloud-error.js';
import { CLI_EXEMPT_OPERATIONS } from '../utils/cloud-operations/exemptions.js';
import {
  commandShape,
  type CloudCommandField,
  type CloudCommandShape,
} from '../utils/cloud-operations/command-shape.js';
import { buildOperationInput } from '../utils/cloud-operations/operation-input.js';
import { isUnattended } from '../utils/input-mode.js';
import { emitResult, isJsonOutput } from '../utils/machine-output.js';
import { promptConfirmation, promptSecret } from '../utils/prompts.js';

/**
 * `hypequery <group> <action>`: one command per hypequery Cloud `/v1`
 * operation, built from the generated operations table, so the CLI covers
 * every operation the spec lists (AG-09f). Each command calls the operation
 * through `@hypequery/cloud-client` with the credential from `hypequery login`
 * or HYPEQUERY_API_TOKEN, and prints the operation's output as JSON.
 */
export const CLOUD_COMMAND_SHAPES: readonly CloudCommandShape[] = CLOUD_OPERATION_SPECS
  .filter(operation => !Object.hasOwn(CLI_EXEMPT_OPERATIONS, operation.name))
  .map(commandShape);

export interface CloudOperationDependencies extends CloudDeploymentAccessDependencies {
  readonly fetch?: typeof fetch;
  readonly stdin?: NodeJS.ReadableStream & { readonly isTTY?: boolean };
  readonly writeStdout?: (text: string) => void;
  readonly writeStderr?: (text: string) => void;
  readonly confirm?: (message: string) => Promise<boolean>;
  readonly promptSecret?: (message: string) => Promise<string>;
}

const SECRET_OUTPUT_WARNING = 'Cloud shows this secret only once. It is printed to stdout and nowhere else: '
  + 'store it in your secret manager now. hypequery does not save or log it.';

function canPrompt(stdin: { readonly isTTY?: boolean }): boolean {
  return stdin.isTTY === true && !isJsonOutput() && !isUnattended();
}

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function commandLine(shape: CloudCommandShape): string {
  return `hypequery ${shape.group} ${shape.action}`;
}

function confirmationRefused(shape: CloudCommandShape): CliError {
  const spec = CLOUD_ERRORS.CONFIRMATION_REQUIRED;
  return new CliError(
    'CONFIRMATION_REQUIRED',
    `${commandLine(shape)} changes something that is hard to undo: ${shape.operation.summary} `
      + 'Nothing was changed. Run it again with --yes once the change is agreed.',
    {
      hint: 'Run the command again with --yes once the change is agreed.',
      category: 'correctable_input',
      docsUrl: spec.docsUrl,
    },
  );
}

function confirmationDeclined(): CliError {
  return new CliError('CONFIRMATION_DECLINED', 'Not confirmed; nothing was changed.', {
    hint: 'Run the command again and confirm, or pass --yes.',
    category: 'cancelled',
    exitClass: 'correctable',
  });
}

function target(input: Readonly<Record<string, unknown>>): string {
  return typeof input.project === 'string' ? `project ${input.project}` : 'your organisation';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Run one operation: build its input, confirm if it is destructive, call Cloud, print the output. */
export async function runCloudOperation(
  shape: CloudCommandShape,
  positionals: readonly string[],
  options: Readonly<Record<string, unknown>>,
  dependencies: CloudOperationDependencies = {},
): Promise<unknown> {
  const stdin = dependencies.stdin ?? process.stdin;
  const interactive = canPrompt(stdin);
  const confirmed = options.yes === true;
  // Refuse before reading credentials or calling Cloud: nobody can say yes.
  if (shape.confirmation === 'required' && !confirmed && !interactive) throw confirmationRefused(shape);

  const access = await resolveCloudApiAccess(dependencies);
  const ask = dependencies.confirm ?? ((message: string) => promptConfirmation(message, '--yes'));
  const input = await buildOperationInput(shape, positionals, options, {
    ...(access.defaultProject ? { defaultProject: access.defaultProject } : {}),
    readStdin: () => readAll(stdin),
    ...(interactive
      ? {
          promptSecret: (field: CloudCommandField) => (dependencies.promptSecret
            ?? ((message: string) => promptSecret(message, field.flag)))(`${field.property} (hidden)`),
        }
      : {}),
  });

  if (shape.confirmation === 'required' && !confirmed) {
    const agreed = await ask(`${shape.operation.summary} This runs ${shape.operation.name} on ${target(input)}. Continue?`);
    if (!agreed) throw confirmationDeclined();
  }

  const client = createCloudClient({
    token: access.token,
    baseUrl: access.baseUrl,
    ...(dependencies.fetch ? { fetch: dependencies.fetch } : {}),
    headers: { 'user-agent': `hypequery-cli/${getCliVersion()}` },
  });
  const call = client.call as unknown as (name: string, input: Record<string, unknown>) => Promise<unknown>;
  const send = (body: Record<string, unknown>) => call(shape.operation.name, body);

  let output: unknown;
  try {
    output = await send(shape.confirmation === 'none' || (shape.confirmation === 'optional' && !confirmed)
      ? input
      : { ...input, confirm: true });
  } catch (error) {
    if (!isCloudApiError(error)) throw error;
    // Some changes need confirming only in some cases (disabling a tenant):
    // Cloud says which, and a person at a terminal can agree and retry.
    if (error.code === 'CONFIRMATION_REQUIRED' && shape.confirmation === 'optional' && !confirmed) {
      if (!interactive) throw cliErrorFromCloud(error, { hint: 'Run the command again with --yes once the change is agreed.' });
      if (!await ask(`${error.message} Continue?`)) throw confirmationDeclined();
      try {
        output = await send({ ...input, confirm: true });
      } catch (retryError) {
        throw isCloudApiError(retryError) ? cliErrorFromCloud(retryError) : retryError;
      }
    } else {
      throw cliErrorFromCloud(error);
    }
  }

  printOutput(shape, output, dependencies);
  return output;
}

function printOutput(shape: CloudCommandShape, output: unknown, dependencies: CloudOperationDependencies): void {
  const writeStderr = dependencies.writeStderr ?? ((text: string) => { process.stderr.write(text); });
  if (shape.secretOutput) writeStderr(`Warning: ${SECRET_OUTPUT_WARNING}\n`);
  if (isJsonOutput()) {
    emitResult(isRecord(output) ? output : { result: output });
    return;
  }
  const writeStdout = dependencies.writeStdout ?? ((text: string) => { process.stdout.write(text); });
  writeStdout(`${JSON.stringify(output, null, 2)}\n`);
}

function describeField(field: CloudCommandField, shape: CloudCommandShape): string {
  const notes: string[] = [];
  if (field.placement === 'project') {
    return shape.operation.scope === 'project'
      ? 'Cloud project slug (default: the project your sign-in names)'
      : field.description ?? 'Cloud project slug';
  }
  if (field.placement === 'secret') {
    return `Read ${field.property} from stdin${field.required ? ' (required; prompted for at a terminal)' : ''}; never pass a secret as a flag value`;
  }
  if (field.description) notes.push(field.description.replace(/\.$/, ''));
  if (field.choices) notes.push(`${field.kind === 'list' ? 'each one of' : 'one of'}: ${field.choices.join(', ')}`);
  if (field.kind === 'list') notes.push('repeat the flag for each value');
  if (field.kind === 'json') notes.push('JSON');
  if (field.nullable) notes.push('null for none');
  if (field.required) notes.push(field.placement === 'argument' ? 'required, here or in --input-json' : 'required');
  return notes.join('; ') || field.property;
}

function addField(command: Command, field: CloudCommandField, shape: CloudCommandShape): void {
  const description = describeField(field, shape);
  switch (field.placement) {
    case 'argument':
      // Optional to Commander, so `--input-json` alone can carry the whole
      // input; buildOperationInput refuses when neither supplies the field.
      command.argument(`[${field.flag.slice(1, -1)}]`, description);
      return;
    case 'project':
      command.option('--project <slug>', description);
      return;
    case 'secret':
      command.option(field.flag, description);
      return;
    case 'confirm':
      return;
    case 'option':
      if (field.kind === 'boolean') {
        command.option(field.flag, description);
        command.option(`--no-${field.flag.slice(2)}`, `Send ${field.property}: false`);
      } else if (field.kind === 'list') {
        command.addOption(new Option(`${field.flag} <value>`, description)
          .argParser((value: string, previous: string[] | undefined) => [...(previous ?? []), value]));
      } else {
        command.option(`${field.flag} <value>`, description);
      }
  }
}

function helpFooter(shape: CloudCommandShape): string {
  const lines = [
    '',
    `Cloud operation: ${shape.operation.name} (your role needs ${shape.operation.capability}).`,
  ];
  if (shape.confirmation === 'required') {
    lines.push('Destructive: refused without --yes, unless you confirm at a terminal.');
  } else if (shape.confirmation === 'optional') {
    lines.push('Some changes need confirming: pass --yes, or confirm at a terminal when Cloud asks.');
  }
  if (shape.secretOutput) lines.push('Returns a secret Cloud shows once: printed to stdout only, never saved or logged.');
  lines.push('Prints the operation\'s output as JSON on stdout; with --json, exactly one JSON document.');
  lines.push('Exit codes: 0 ok, 1 correctable, 2 auth, 3 plan, 4 transient, 5 internal.');
  return lines.join('\n');
}

const operationCommands = new WeakMap<Command, CloudCommandShape>();
const groupNames: ReadonlySet<string> = new Set(CLOUD_COMMAND_SHAPES.map(shape => shape.group));

/** `releases`, `members`, …: a top-level command that only groups Cloud operation commands. */
export function isCloudOperationGroup(name: string): boolean {
  return groupNames.has(name);
}

/**
 * The options of the operation command `args` names that take a value, for
 * telemetry: it reports only the flags every operation shares, but must step
 * over every option's value so a value is never read as a flag
 * (`feedback create --summary '--yes'`). Empty when `args` names no operation.
 */
export function cloudOperationValueFlags(program: Command, args: readonly string[]): string[] {
  // Nothing before the action takes a value, so the first two words are the group and the action.
  const [groupName, actionName] = args.filter(arg => !arg.startsWith('-'));
  const group = program.commands.find(command => command.name() === groupName);
  const command = group?.commands.find(candidate => candidate.name() === actionName);
  if (!command || !operationCommands.has(command)) return [];
  return command.options
    .filter(option => option.required || option.optional)
    .flatMap(option => option.long ? [option.long] : []);
}

/** The operation a Commander command runs, if it is one of these commands. */
export function cloudOperationOf(command: Command): CloudCommandShape | undefined {
  return operationCommands.get(command);
}

type Wrap = <TArgs extends unknown[]>(action: (...args: TArgs) => Promise<void>) => (...args: TArgs) => Promise<void>;

/** Add `hypequery <group> <action>` for every operation in the spec. */
export function registerCloudOperationCommands(
  program: Command,
  wrap: Wrap,
  dependencies: CloudOperationDependencies = {},
): void {
  const groups = new Map<string, { command: Command; actions: string[] }>();
  for (const shape of CLOUD_COMMAND_SHAPES) {
    let group = groups.get(shape.group);
    if (!group) {
      group = { command: program.command(shape.group), actions: [] };
      groups.set(shape.group, group);
    }
    group.actions.push(shape.action);
    const command = group.command.command(shape.action).description(shape.operation.summary);
    for (const field of shape.fields) addField(command, field, shape);
    // Help still shows path parameters as required: `releases get [options] <version>`.
    command.usage(['[options]', ...shape.fields.filter(field => field.placement === 'argument').map(field => field.flag)].join(' '));
    command.option('--input-json <json>', 'The whole input as a JSON object (inline, @<file>, or - for stdin); flags override its fields');
    if (shape.confirmation !== 'none') command.option('-y, --yes', 'Confirm the change without a prompt');
    command.addHelpText('after', helpFooter(shape));
    const argumentCount = shape.fields.filter(field => field.placement === 'argument').length;
    command.action(wrap(async (...args: unknown[]) => {
      const positionals = args.slice(0, argumentCount) as string[];
      const options = (args[argumentCount] ?? {}) as Record<string, unknown>;
      await runCloudOperation(shape, positionals, options, dependencies);
    }));
    operationCommands.set(command, shape);
  }
  for (const [name, group] of groups) {
    group.command.description(`hypequery Cloud ${name}: ${group.actions.join(', ')}`);
  }
}
