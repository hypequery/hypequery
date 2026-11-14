'use client';

import type { ComponentType, ReactNode } from 'react';
import Link from 'next/link';
import { Bot, Boxes, Cloud, Database, HardDrive, Server, SquareTerminal } from 'lucide-react';
import { RiOpenaiFill } from 'react-icons/ri';
import {
  SiAnthropic,
  SiBun,
  SiClaude,
  SiClickhouse,
  SiCloudflareworkers,
  SiCursor,
  SiDjango,
  SiExpress,
  SiFastapi,
  SiFastify,
  SiFlask,
  SiGunicorn,
  SiHono,
  SiJupyter,
  SiModelcontextprotocol,
  SiNextdotjs,
  SiNodedotjs,
  SiPython,
  SiReactrouter,
  SiSvelte,
  SiTypescript,
  SiVercel,
} from 'react-icons/si';
import { trackUmamiEvent } from '@/lib/umami';
import { RUNTIME_EXAMPLES, type RuntimeLanguage } from './runtimeExamples';
import { AGENT_GROUPS, DATABASE_GROUPS, type StackGroup } from './stackTargets';

type Icon = ComponentType<{ className?: string }>;

const ICONS: Record<string, Icon> = {
  nextjs: SiNextdotjs,
  'react-router': SiReactrouter,
  sveltekit: SiSvelte,
  express: SiExpress,
  fastify: SiFastify,
  hono: SiHono,
  workers: SiCloudflareworkers,
  'bun-deno': SiBun,
  'node-jobs': SiNodedotjs,
  fastapi: SiFastapi,
  django: SiDjango,
  flask: SiFlask,
  starlette: SiPython,
  servers: SiGunicorn,
  notebooks: SiJupyter,
  'ai-sdk': SiVercel,
  'anthropic-sdk': SiAnthropic,
  'openai-agents': RiOpenaiFill,
  claude: SiClaude,
  cursor: SiCursor,
  codex: SquareTerminal,
  'mcp-clients': SiModelcontextprotocol,
  'clickhouse-cloud': SiClickhouse,
  'self-hosted': HardDrive,
  chdb: Boxes,
  'your-servers': Server,
  'hypequery-cloud': Cloud,
};

const LANGUAGES: Array<{ language: RuntimeLanguage; label: string; Icon: Icon; color: string }> = [
  { language: 'typescript', label: 'TypeScript', Icon: SiTypescript, color: 'text-[#3178c6]' },
  { language: 'python', label: 'Python', Icon: SiPython, color: 'text-[#3776ab]' },
];

// The frameworks, grouped by language, in the same shape as the agent and database columns.
const BACKEND_GROUPS: Array<StackGroup & { Icon: Icon; color: string }> = LANGUAGES.map(({ language, label, Icon, color }) => ({
  label,
  Icon,
  color,
  targets: RUNTIME_EXAMPLES.filter((example) => example.language === language),
}));

function Chip({ id, name, detail, href, column }: { id: string; name: string; detail: string; href: string; column: string }) {
  const ChipIcon = ICONS[id];
  return (
    <li>
      <Link
        href={href}
        title={detail}
        onClick={() => trackUmamiEvent('runtime_link', { runtime: id, column, page: '/' })}
        className="group inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-bg-card px-2.5 text-[12.5px] font-medium text-text-muted transition hover:border-border-strong hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {ChipIcon ? <ChipIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
        <span className="whitespace-nowrap">{name}</span>
      </Link>
    </li>
  );
}

function Column({ id, Icon, title, description, groups }: {
  id: string;
  Icon: Icon;
  title: string;
  description: ReactNode;
  groups: Array<StackGroup & { Icon?: Icon; color?: string }>;
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-border bg-bg-card/40 p-5 sm:p-6">
      <div className="flex items-center gap-2.5">
        <Icon className="h-5 w-5 text-accent" aria-hidden="true" />
        <h3 className="text-xl font-medium tracking-tight text-text">{title}</h3>
      </div>
      <p className="mt-2 text-sm leading-6 text-text-muted">{description}</p>
      <div className="mt-5 space-y-4">
        {groups.map(({ label, targets, Icon: GroupIcon, color }) => (
          <div key={label}>
            <p className="flex items-center gap-1.5 font-mono text-[11px] text-text-dim">
              {GroupIcon ? <GroupIcon className={`h-3 w-3 ${color ?? ''}`} aria-hidden="true" /> : null}
              {label}
            </p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {targets.map((target) => <Chip key={target.id} {...target} column={id} />)}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

/** "Runs where your app runs": the frameworks, agents and ClickHouse hypequery fits into, each linking to its docs. */
export function RunsWhereYourAppRuns() {
  return (
    <section aria-labelledby="runs-where-title" className="mx-auto max-w-[1280px] px-5 pt-14 sm:px-8 sm:pt-20">
      <div className="max-w-[720px]">
        <h2 id="runs-where-title" className="home-section-title text-text">Runs where your app runs</h2>
        <p className="mt-4 text-sm leading-6 text-text-muted sm:text-base">
          hypequery is a library, not another service to deploy. Mount it in the framework you already use, hand it to
          your agents, and point it at the ClickHouse you already have.
        </p>
      </div>

      <div className="mt-10 grid gap-4 lg:grid-cols-3">
        <Column
          id="backend"
          Icon={Server}
          title="Your backend"
          description="Mount it beside your routes, in TypeScript or Python. Same datasets, same endpoints, same tenant rules."
          groups={BACKEND_GROUPS}
        />
        <Column
          id="agents"
          Icon={Bot}
          title="Your agents"
          description="Tools for the agent in your product, or MCP for Claude and Cursor. They query your datasets, never raw SQL."
          groups={AGENT_GROUPS}
        />
        <Column
          id="database"
          Icon={Database}
          title="Your ClickHouse"
          description="Cloud, self-hosted or embedded with chDB. Run hypequery in your own app, or let hypequery Cloud host it."
          groups={DATABASE_GROUPS}
        />
      </div>
    </section>
  );
}
