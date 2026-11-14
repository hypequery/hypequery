import path from 'node:path';
import { buildSlackManifest } from '@hypequery/slack';
import { readGeneratedFile, writeGeneratedFileAtomically } from '../utils/generated-file.js';
import { logger } from '../utils/logger.js';
import { emitResult } from '../utils/machine-output.js';
import { CliError, outputConflictError } from '../utils/cli-error.js';

export interface SlackOptions {
  name?: string;
  url?: string;
  socket?: boolean;
  threadHistory?: boolean;
  output?: string;
  force?: boolean;
}

export interface SlackDependencies {
  readonly cwd?: string;
}

const DEFAULT_OUTPUT = 'slack-app-manifest.json';
const USAGE = 'Usage: hypequery slack init (--url <https request url> | --socket) [--name <name>] [--thread-history] [--output <file>] [--force]';

/** `hypequery slack init`: write a Slack app manifest for a hypequery analytics bot and print the setup steps. */
export async function slackCommand(
  action: string | undefined,
  options: SlackOptions = {},
  dependencies: SlackDependencies = {},
): Promise<void> {
  if (action !== 'init') throw new CliError('USAGE', USAGE);
  if (options.url && options.socket) throw new CliError('USAGE', '--url and --socket cannot be combined.', { hint: USAGE });
  if (!options.url && !options.socket) {
    throw new CliError('USAGE', 'Pass --url with your bot\'s public https Request URL, or --socket for Socket Mode (no public URL).', {
      hint: USAGE,
    });
  }

  let manifest: Record<string, unknown>;
  try {
    manifest = buildSlackManifest({
      name: options.name,
      requestUrl: options.url,
      socketMode: options.socket ?? false,
      channelThreadHistory: options.threadHistory ?? false,
    });
  } catch (error) {
    throw new CliError('USAGE', (error as Error).message.replace(/^buildSlackManifest: /, ''), { hint: USAGE });
  }

  const cwd = dependencies.cwd ?? process.cwd();
  const file = path.resolve(cwd, options.output ?? DEFAULT_OUTPUT);
  const content = `${JSON.stringify(manifest, null, 2)}\n`;
  const current = await readGeneratedFile(file);
  if (current !== undefined && current !== content && !options.force) {
    throw outputConflictError(`Refusing to overwrite ${path.relative(cwd, file)}. Use --force to replace it.`, [file]);
  }
  if (current !== content) await writeGeneratedFileAtomically(file, content, { overwrite: current !== undefined });

  const env = options.socket
    ? ['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN']
    : ['SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET'];
  logger.success(`Wrote ${path.relative(cwd, file)}`);
  logger.newline();
  logger.info('Next:');
  logger.indent('1. Open https://api.slack.com/apps?new_app=1, choose "From a manifest", pick a workspace and paste the file.');
  logger.indent('2. Install the app to the workspace, then copy the Bot User OAuth Token into SLACK_BOT_TOKEN.');
  logger.indent(options.socket
    ? '3. Basic Information → App-Level Tokens: create one with connections:write and put it in SLACK_APP_TOKEN.'
    : '3. Basic Information → Signing Secret: put it in SLACK_SIGNING_SECRET. Slack checks the Request URL when you save it, so deploy first.');
  if (options.threadHistory) {
    logger.indent('Note: --thread-history lets the bot read every message in channels it is added to.');
  }
  emitResult({ file, socketMode: options.socket ?? false, env, manifest });
}
