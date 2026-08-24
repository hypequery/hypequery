/**
 * Env files the CLI loads, in precedence order, most specific first.
 *
 * This mirrors the cascade Next.js and Vite use. `dotenv` never overwrites a
 * variable that is already set, so loading in this order means earlier entries
 * win, and a real `process.env` value beats every file.
 *
 * `.env.local` matters in particular: it is the file those frameworks read, so
 * without it a project could have working app credentials and a CLI that could
 * not connect — with an error that never mentions the env file.
 */
export function envFiles(nodeEnv: string | undefined): string[] {
  return [
    ...(nodeEnv ? [`.env.${nodeEnv}.local`] : []),
    '.env.local',
    ...(nodeEnv ? [`.env.${nodeEnv}`] : []),
    '.env',
  ];
}
