'use client';

import type { ComponentType } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import {
  SiBun,
  SiCloudflareworkers,
  SiDjango,
  SiExpress,
  SiFastapi,
  SiFastify,
  SiFlask,
  SiGunicorn,
  SiHono,
  SiJupyter,
  SiNextdotjs,
  SiNodedotjs,
  SiPython,
  SiReactrouter,
  SiSvelte,
  SiTypescript,
} from 'react-icons/si';
import { trackUmamiEvent } from '@/lib/umami';
import { RUNTIME_EXAMPLES, type RuntimeLanguage } from './runtimeExamples';
import { marketing } from '@/components/ui/marketing';

const ICONS: Record<string, ComponentType<{ className?: string }>> = {
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
};

const GROUPS: Array<{ language: RuntimeLanguage; label: string; Icon: ComponentType<{ className?: string }> }> = [
  { language: 'typescript', label: 'TypeScript', Icon: SiTypescript },
  { language: 'python', label: 'Python', Icon: SiPython },
];

/** "Runs where your app runs": every framework we support, each linking to its docs. */
export function RunsWhereYourAppRuns() {
  return (
    <section aria-labelledby="runs-where-title" className={`mx-auto max-w-[1280px] px-5 sm:px-8 ${marketing.homeSectionSpacing}`}>
      <div className="max-w-[720px]">
        <h2 id="runs-where-title" className="home-section-title text-text">Runs where your app runs</h2>
        <p className="mt-4 text-sm leading-6 text-text-muted sm:text-base">
          hypequery is a library, not another service to deploy. Mount it in the framework you already use, in
          TypeScript or Python. Same datasets, same endpoints, same tenant rules.
        </p>
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        {GROUPS.map(({ language, label, Icon: GroupIcon }) => (
          <div key={language}>
            <p className="flex items-center gap-2 font-mono text-xs text-text-muted">
              <GroupIcon className={`h-3.5 w-3.5 ${language === 'typescript' ? 'text-[#3178c6]' : 'text-[#3776ab]'}`} aria-hidden="true" />
              {label}
            </p>
            <ul className="mt-2 grid gap-2 max-sm:grid-cols-2 sm:grid-cols-3">
              {RUNTIME_EXAMPLES.filter((example) => example.language === language).map((example) => {
                const Icon = ICONS[example.id];
                return (
                  <li key={example.id}>
                    <Link
                      href={example.href}
                      onClick={() => trackUmamiEvent('runtime_link', { runtime: example.id, page: '/' })}
                      className="group flex h-full w-full flex-col items-start gap-2 rounded-xl border border-border bg-bg-card p-3 text-left transition hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    >
                      <span className="flex w-full items-center justify-between">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border text-text-muted group-hover:text-text">
                          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                        </span>
                        <ArrowRight className="h-3.5 w-3.5 text-text-muted opacity-0 transition group-hover:opacity-100" aria-hidden="true" />
                      </span>
                      <span className="w-full min-w-0">
                        <span className="block truncate text-sm font-medium text-text">{example.name}</span>
                        <span className="mt-0.5 block text-[11px] leading-4 text-text-muted">{example.detail}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
