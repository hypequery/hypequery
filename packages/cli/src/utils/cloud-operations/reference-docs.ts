import type { CloudCommandField, CloudCommandShape } from './command-shape.js';

/**
 * The docs page for every `hypequery <group> <action>` command
 * (website-next/docs/cloud/cli-operations.mdx), rendered from the same command
 * shapes the CLI registers, so the reference can't drift from the commands.
 * `pnpm --filter @hypequery/cli cloud-operations:docs` writes it; a test fails
 * when it is stale.
 */

/** Text in an MDX table cell or paragraph: no JSX, no expressions, no column breaks. */
function escape(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/[{}]/g, match => `\\${match}`)
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\|/g, '\\|')
    .trim();
}

function code(text: string): string {
  return `\`${text.replace(/\|/g, '\\|')}\``;
}

function usage(shape: CloudCommandShape): string {
  const argumentsPart = shape.fields.filter(field => field.placement === 'argument').map(field => ` ${field.flag}`).join('');
  return `hypequery ${shape.group} ${shape.action}${argumentsPart}`;
}

function value(field: CloudCommandField): string {
  if (field.placement === 'secret') return 'stdin';
  if (field.placement === 'argument' || field.placement === 'project') return 'text';
  const base = field.choices ? field.choices.map(choice => code(choice)).join(', ') : {
    string: 'text', integer: 'whole number', number: 'number', boolean: 'flag', list: 'text, repeatable', json: 'JSON',
  }[field.kind];
  const repeat = field.kind === 'list' && field.choices ? ' (repeatable)' : '';
  return `${base}${repeat}${field.nullable ? ', or `null`' : ''}`;
}

function flagCell(field: CloudCommandField): string {
  if (field.placement === 'argument') return code(field.flag);
  if (field.placement === 'option' && field.kind === 'boolean') return `${code(field.flag)} / ${code(`--no-${field.flag.slice(2)}`)}`;
  return code(field.flag);
}

function describe(field: CloudCommandField, shape: CloudCommandShape): string {
  const parts: string[] = [];
  if (field.placement === 'project') {
    parts.push(shape.operation.scope === 'project'
      ? 'Cloud project slug. Defaults to the project your sign-in names.'
      : escape(field.description ?? 'Cloud project slug.'));
  } else if (field.placement === 'secret') {
    parts.push(`Reads ${code(field.property)} from stdin. At a terminal the CLI asks for it without echoing; never pass it as a flag value.`);
  } else if (field.description) {
    parts.push(escape(field.description));
  }
  if (field.required && field.placement !== 'project') parts.push('Required.');
  return parts.join(' ') || code(field.property);
}

function renderCommand(shape: CloudCommandShape): string[] {
  const lines = [`### ${code(usage(shape))}`, '', escape(shape.operation.summary), ''];
  const fields = shape.fields.filter(field => field.placement !== 'confirm');
  lines.push('| Argument or flag | Value | Description |', '| --- | --- | --- |');
  for (const field of fields) lines.push(`| ${flagCell(field)} | ${value(field)} | ${describe(field, shape)} |`);
  if (shape.confirmation !== 'none') {
    lines.push(`| ${code('--yes')} | flag | ${shape.confirmation === 'required'
      ? 'Confirms the change. Required without a terminal.'
      : 'Confirms a change Cloud asks about.'} |`);
  }
  lines.push(`| ${code('--input-json')} | JSON, ${code('@file')} or ${code('-')} | The whole input as one object; flags override its fields. |`);
  lines.push('');
  const notes = [`Operation ${code(shape.operation.name)}; your role needs ${code(shape.operation.capability)}.`];
  if (shape.confirmation === 'required') notes.push('Destructive: refused without `--yes` unless you confirm at a terminal.');
  if (shape.confirmation === 'optional') notes.push('Cloud asks for confirmation in some cases; pass `--yes` or confirm at a terminal.');
  if (shape.secretOutput) notes.push('Returns a secret Cloud shows once: it is printed to stdout only, with a warning on stderr, and never saved or logged.');
  lines.push(notes.join(' '), '');
  return lines;
}

export function renderCloudCommandReference(shapes: readonly CloudCommandShape[]): string {
  const groups = new Map<string, CloudCommandShape[]>();
  for (const shape of shapes) groups.set(shape.group, [...(groups.get(shape.group) ?? []), shape]);
  const lines = [
    '---',
    'title: Cloud operation commands',
    'description: One hypequery CLI command for every hypequery Cloud operation, generated from the operations spec.',
    '---',
    '',
    '{/* Generated from specs/cloud-api/operations-v1.json by `pnpm --filter @hypequery/cli cloud-operations:docs`. Do not edit by hand. */}',
    '',
    'Every hypequery Cloud operation is a CLI command: `hypequery <group> <action>`. The commands are built from',
    'the same operations spec as the REST API, so they cover everything an agent or the dashboard can do.',
    '',
    '| Group | Actions |',
    '| --- | --- |',
    ...[...groups].map(([group, members]) => `| [${code(group)}](#${group}) | ${members.map(shape => shape.action).join(', ')} |`),
    '',
    '## How the commands behave',
    '',
    '- **Credentials.** The same as every Cloud command: `HYPEQUERY_API_TOKEN`, then the management token from',
    '  `hypequery login` or `hypequery login --device`, then the browser sign-in. See [CLI commands](/docs/cloud/cli).',
    '- **Project.** `--project <slug>` names the project. Project operations default to the project your sign-in names.',
    '- **Output.** Each command prints the operation\'s output as JSON on stdout. With `--json` stdout carries exactly',
    '  that document, or the error envelope (`code`, `message`, `hint`, `docsUrl`, `requestId`, `issues`).',
    '- **Exit codes.** 0 ok, 1 correctable, 2 auth, 3 plan, 4 transient, 5 internal.',
    '- **Destructive operations** need `--yes`. At a terminal the CLI asks instead; without one (or with `--json`,',
    '  `--no-input` or `CI`) it refuses with `CONFIRMATION_REQUIRED` and changes nothing.',
    '- **Secrets.** Secret inputs (a ClickHouse password, an OIDC client secret) come from stdin with',
    '  `--<field>-stdin`, a hidden prompt, or `--input-json`, never a flag value. New keys are printed to stdout once,',
    '  with a warning on stderr.',
    '- **Values.** Lists repeat the flag (`--scopes a --scopes b`); `null` sends JSON null where a field allows it;',
    '  object fields take JSON. `--input-json` takes the whole input as an object, inline, from `@file` or from `-` (stdin).',
    '',
  ];
  for (const [group, members] of groups) {
    lines.push(`## ${group}`, '');
    for (const shape of members) lines.push(...renderCommand(shape));
  }
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}
