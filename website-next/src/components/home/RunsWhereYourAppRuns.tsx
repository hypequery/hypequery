'use client';

import { useState, type ComponentType, type KeyboardEvent } from 'react';
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
import CodeHighlight from '@/components/CodeHighlight';
import { trackUmamiEvent } from '@/lib/umami';
import { RUNTIME_EXAMPLES, type RuntimeLanguage } from './runtimeExamples';

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

/** "Runs where your app runs": every framework we support on the left, its code on the right. */
export function RunsWhereYourAppRuns() {
  const [activeId, setActiveId] = useState(RUNTIME_EXAMPLES[0].id);
  const active = RUNTIME_EXAMPLES.find((example) => example.id === activeId) ?? RUNTIME_EXAMPLES[0];

  const select = (id: string) => {
    if (id === activeId) return;
    setActiveId(id);
    trackUmamiEvent('runtime_tab', { runtime: id, page: '/' });
  };

  // One tab list across both groups, so arrow keys move through every framework in order.
  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const step: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
    if (!(event.key in step) && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const count = RUNTIME_EXAMPLES.length;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : (index + step[event.key] + count) % count;
    select(RUNTIME_EXAMPLES[next].id);
    document.getElementById(`runtime-tab-${RUNTIME_EXAMPLES[next].id}`)?.focus();
  };

  return (
    <section aria-labelledby="runs-where-title" className="mx-auto max-w-[1280px] px-5 pt-14 sm:px-8 sm:pt-20">
      <div className="max-w-[720px]">
        <h2 id="runs-where-title" className="home-section-title text-text">Runs where your app runs</h2>
        <p className="mt-4 text-sm leading-6 text-text-muted sm:text-base">
          hypequery is a library, not another service to deploy. Mount it in the framework you already use, in
          TypeScript or Python. Same datasets, same endpoints, same tenant rules.
        </p>
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div role="tablist" aria-label="Frameworks" aria-orientation="vertical" className="space-y-6">
          {GROUPS.map(({ language, label, Icon: GroupIcon }) => (
            <div key={language}>
              <p className="flex items-center gap-2 font-mono text-xs text-text-muted">
                <GroupIcon className={`h-3.5 w-3.5 ${language === 'typescript' ? 'text-[#3178c6]' : 'text-[#3776ab]'}`} aria-hidden="true" />
                {label}
              </p>
              <div className="mt-2 grid gap-2 max-sm:grid-cols-2 sm:grid-cols-3">
                {RUNTIME_EXAMPLES.filter((example) => example.language === language).map((example) => {
                  const index = RUNTIME_EXAMPLES.indexOf(example);
                  const selected = example.id === active.id;
                  const Icon = ICONS[example.id];
                  return (
                    <button
                      key={example.id}
                      id={`runtime-tab-${example.id}`}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      aria-controls="runtime-panel"
                      tabIndex={selected ? 0 : -1}
                      onClick={() => select(example.id)}
                      onKeyDown={(event) => onKeyDown(event, index)}
                      className={`flex h-full w-full flex-col items-start gap-2 rounded-xl border p-3 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${selected ? 'border-accent bg-accent-soft' : 'border-border bg-bg-card hover:border-border-strong'}`}
                    >
                      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${selected ? 'border-accent/40 bg-bg-card text-accent' : 'border-border text-text-muted'}`}>
                        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                      <span className="w-full min-w-0">
                        <span className="block truncate text-sm font-medium text-text">{example.name}</span>
                        <span className="mt-0.5 block text-[11px] leading-4 text-text-muted">{example.detail}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div
          id="runtime-panel"
          role="tabpanel"
          aria-labelledby={`runtime-tab-${active.id}`}
          className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-bg-card shadow-card"
        >
          {/* Fixed height so switching frameworks never moves the page. */}
          <div className="min-h-0 overflow-y-auto bg-bg-alt/50 max-sm:p-5 sm:p-6 max-lg:h-[380px] lg:flex-1">
            <CodeHighlight
              key={active.id}
              code={active.code}
              language={active.language}
              className="[&_code]:leading-[1.8] max-sm:[&_code]:text-[12px] sm:[&_code]:text-[13px]"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
