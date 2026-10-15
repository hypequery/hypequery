'use client';

import { useState } from 'react';
import { Code2, Sparkles } from 'lucide-react';
import { trackUmamiEvent } from '@/lib/umami';
import { AiAuthoringPanel } from './AiAuthoring';
import { DatasetQuickstartPanel } from './DatasetQuickstart';

const PATHS = [
  { id: 'ai', title: 'With AI', detail: 'Describe your business in cloud', badge: 'Early access', Icon: Sparkles },
  { id: 'code', title: 'In code', detail: 'TypeScript or Python, in your repo', badge: 'Open source', Icon: Code2 },
] as const;

type PathId = (typeof PATHS)[number]['id'];

/** The two ways to build the analytics layer. Both publish the same kind of model to cloud. */
export function BuildYourWay() {
  const [active, setActive] = useState<PathId>('ai');

  const select = (id: PathId) => {
    if (id === active) return;
    setActive(id);
    // Which way people want to build tells us which to lead with.
    trackUmamiEvent('build_path_tab', { path: id, page: '/' });
  };

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? PATHS.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : PATHS.length - 1)) % PATHS.length;
    select(PATHS[next].id);
    document.getElementById(`build-path-tab-${PATHS[next].id}`)?.focus();
  };

  return (
    <section aria-labelledby="build-your-way-title" className="overflow-x-clip">
      <div className="mx-auto max-w-[1280px] px-5 pt-14 sm:px-8 sm:pt-20">
        <div className="max-w-[680px]">
          <h2 id="build-your-way-title" className="home-section-title text-text">Build it with AI, or write it in code</h2>
          <p className="mt-4 text-sm leading-6 text-text-muted sm:text-base">
            Have AI draft it for you in hypequery cloud, or write it in TypeScript or Python and run it wherever you like: in your own backend, or on cloud.
          </p>
        </div>

        <div role="tablist" aria-label="Ways to build" className="mt-8 grid max-w-[640px] grid-cols-2 gap-3">
          {PATHS.map(({ id, title, detail, badge, Icon }, index) => {
            const selected = id === active;
            return (
              <button
                key={id}
                id={`build-path-tab-${id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls="build-path-panel"
                tabIndex={selected ? 0 : -1}
                onClick={() => select(id)}
                onKeyDown={(event) => onKeyDown(event, index)}
                className={`rounded-xl border p-4 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${selected ? 'border-accent bg-accent-soft' : 'border-border bg-bg-card hover:border-border-strong'}`}
              >
                <span className="flex items-center gap-2">
                  <Icon className={`h-4 w-4 ${selected ? 'text-accent' : 'text-text-muted'}`} aria-hidden="true" />
                  <span className="text-base font-medium text-text">{title}</span>
                  <span className="ml-auto rounded-full border border-border px-2 py-0.5 text-[10px] text-text-muted max-sm:hidden">{badge}</span>
                </span>
                <span className="mt-1 block text-xs text-text-muted sm:text-sm">{detail}</span>
              </button>
            );
          })}
        </div>

        {/* Both panels share one grid cell, so the section is always as tall as the taller one and never jumps on switch. */}
        <div className="mt-10 grid">
          {PATHS.map(({ id }) => {
            const selected = id === active;
            return (
              <div
                key={id}
                {...(selected ? { id: 'build-path-panel', role: 'tabpanel', 'aria-labelledby': `build-path-tab-${id}` } : { 'aria-hidden': true })}
                inert={!selected}
                className={`[grid-area:1/1] ${selected ? '' : 'invisible'}`}
              >
                {id === 'ai' ? <AiAuthoringPanel /> : <DatasetQuickstartPanel />}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
