'use client';

import { useEffect, useRef, useState } from 'react';
import { useInView } from 'motion/react';
import { Cloud, Code2 } from 'lucide-react';
import { trackUmamiEvent } from '@/lib/umami';
import { AiAuthoringPanel } from './AiAuthoring';
import { DatasetQuickstartPanel } from './DatasetQuickstart';

// The first path is the default tab. Cloud, where AI drafts the model, is waitlist-only.
const PATHS = [
  { id: 'cloud', title: 'In cloud', detail: 'Drafted with AI, reviewed by you', badge: 'Early access', Icon: Cloud },
  { id: 'code', title: 'In code', detail: 'TypeScript or Python, in your repo', badge: 'Open source', Icon: Code2 },
] as const;

type PathId = (typeof PATHS)[number]['id'];

/** The two ways to build the analytics layer. Both produce the same model, reviewed like code. */
export function BuildYourWay() {
  const [active, setActive] = useState<PathId>(PATHS[0].id);
  const sectionRef = useRef<HTMLElement>(null);
  const inView = useInView(sectionRef, { once: true, amount: 0.3 });

  // Tab events only fire on a switch, so log the default tab once it's seen. Without this the
  // default path never shows up in the data and the comparison is skewed.
  useEffect(() => {
    if (inView) trackUmamiEvent('build_path_view', { path: PATHS[0].id, page: '/' });
  }, [inView]);

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
    <section ref={sectionRef} aria-labelledby="build-your-way-title" className="overflow-x-clip">
      <div className="mx-auto max-w-[1280px] px-5 pt-14 sm:px-8 sm:pt-20">
        <div>
          <h2 id="build-your-way-title" className="home-section-title text-text max-sm:text-[min(5.6vw,2rem)]!">Model your data in code or in cloud</h2>
          <p className="mt-4 max-w-[680px] text-sm leading-6 text-text-muted sm:text-base">
            Your semantic model can be managed in your codebase or in cloud, drafted with AI. Either way, it&apos;s the same model.
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
                {id === 'code' ? <DatasetQuickstartPanel /> : <AiAuthoringPanel />}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
