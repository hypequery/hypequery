'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, useInView, useReducedMotion } from 'motion/react';
import { RotateCcw, Sparkles } from 'lucide-react';
import { SiClaude } from 'react-icons/si';

const QUESTION = 'What was revenue by country last month?';

const ROWS = [
  ['GB', '$64,000'],
  ['US', '$48,000'],
  ['DE', '$16,000'],
] as const;

// Claude Code's thinking glyphs.
const SPINNER = ['·', '✢', '✳', '✶', '✻', '✽'];

// Milliseconds after the section scrolls into view.
const T = {
  typePerChar: 28,
  thinking: 1300,
  tool: 2700,
  toolResult: 3100,
  answer: 3600,
  chatUser: 500,
  chatTyping: 1300,
  chatAnswer: 3600,
};
const DONE = T.answer + 800;

const CLAUDE_ORANGE = 'text-[#d97757]';

/** Elapsed time since the animation started, ticking until it finishes. */
function useTimeline(active: boolean, reduced: boolean) {
  const [elapsed, setElapsed] = useState(0);
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (!active || reduced) return;
    const start = performance.now();
    const timer = window.setInterval(() => {
      const next = performance.now() - start;
      setElapsed(next);
      if (next >= DONE) window.clearInterval(timer);
    }, 40);
    return () => window.clearInterval(timer);
  }, [active, reduced, run]);

  return {
    // Reduced motion shows the finished state straight away.
    elapsed: reduced ? DONE : elapsed,
    replay: () => {
      setElapsed(0);
      setRun((value) => value + 1);
    },
  };
}

const reveal = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] as const },
};

function ClaudeTerminal({ elapsed }: { elapsed: number }) {
  const typed = QUESTION.slice(0, Math.min(QUESTION.length, Math.floor(elapsed / T.typePerChar)));
  const typing = typed.length < QUESTION.length;
  const thinking = elapsed >= T.thinking && elapsed < T.tool;
  const glyph = SPINNER[Math.floor(elapsed / 110) % SPINNER.length];

  return (
    <div className="flex h-[360px] flex-col overflow-hidden rounded-xl border border-white/10 bg-[#141413] shadow-card">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-auto mr-auto flex items-center gap-1.5 font-mono text-[11px] text-[#a8a29e]">
          <SiClaude className={`h-3 w-3 ${CLAUDE_ORANGE}`} aria-hidden="true" />
          claude
        </span>
        <span className="w-[42px]" />
      </div>

      <div className="flex-1 space-y-3 p-5 font-mono text-[11.5px] leading-6 text-[#e8e6e3] sm:text-[12.5px]">
        <div className="flex items-center gap-2 rounded-md border border-[#d97757]/40 px-3 py-2 text-[#a8a29e]">
          <SiClaude className={`h-3.5 w-3.5 shrink-0 ${CLAUDE_ORANGE}`} aria-hidden="true" />
          <span><span className="text-[#e8e6e3]">Claude Code</span> · hypequery MCP connected</span>
        </div>

        <div>
          <span className="text-[#a8a29e]">&gt; </span>
          {typed}
          {typing && <span className="ml-px inline-block h-[1.1em] w-[0.55em] translate-y-[3px] animate-pulse bg-[#e8e6e3]" />}
        </div>

        {thinking && (
          <div className={CLAUDE_ORANGE}>
            {glyph} <span className="text-[#d97757]/90">Thinking…</span>
          </div>
        )}

        {elapsed >= T.tool && (
          <motion.div {...reveal}>
            <span className="text-[#4ade80]">⏺</span> <span className="font-semibold">hypequery</span> - query_dataset{' '}
            <span className="text-[#78716c]">(MCP)</span>
            {elapsed >= T.toolResult && (
              <motion.div {...reveal} className="pl-4 text-[#a8a29e]">
                ⎿ orders · revenue by country · last month
              </motion.div>
            )}
          </motion.div>
        )}

        {elapsed >= T.answer && (
          <motion.div {...reveal}>
            <span>⏺</span> Revenue by country, last month:
            <div className="mt-2 pl-4">
              {ROWS.map(([country, revenue], index) => (
                <motion.div
                  key={country}
                  {...reveal}
                  transition={{ ...reveal.transition, delay: 0.08 * (index + 1) }}
                  className="flex max-w-[220px] justify-between"
                >
                  <span className="text-[#a8a29e]">{country}</span>
                  <span>{revenue}</span>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </div>

    </div>
  );
}

function AppChat({ elapsed }: { elapsed: number }) {
  const typing = elapsed >= T.chatTyping && elapsed < T.chatAnswer;

  return (
    <div className="flex h-[360px] flex-col overflow-hidden rounded-xl border border-border bg-bg-card shadow-card">
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-text text-[11px] font-semibold text-bg">A</span>
        <span className="text-xs font-medium text-text">Acme Analytics</span>
      </div>

      <div className="flex flex-1 flex-col gap-4 p-5">
        {elapsed >= T.chatUser && (
          <motion.div {...reveal} className="flex items-end justify-end gap-2">
            <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-accent px-4 py-2.5 text-sm text-white dark:text-[#0c0e14]">{QUESTION}</div>
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-bg-alt text-[10px] font-medium text-text-muted">JD</span>
          </motion.div>
        )}

        {(typing || elapsed >= T.chatAnswer) && (
          <motion.div {...reveal} className="flex items-start gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft">
              <Sparkles className="h-3 w-3 text-accent" aria-hidden="true" />
            </span>
            {typing ? (
              <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm border border-border bg-bg-alt/60 px-4 py-3.5" aria-label="Assistant is typing">
                {[0, 1, 2].map((dot) => (
                  <span key={dot} className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-muted" style={{ animationDelay: `${dot * 120}ms` }} />
                ))}
              </div>
            ) : (
              <motion.div {...reveal} className="max-w-[85%] rounded-2xl rounded-bl-sm border border-border bg-bg-alt/60 px-4 py-3 text-sm text-text">
                GB led last month with <strong className="font-semibold">$64,000</strong>.
                <table className="mt-3 w-[200px] text-left text-xs">
                  <tbody>
                    {ROWS.map(([country, revenue]) => (
                      <tr key={country} className="border-t border-border">
                        <td className="py-1.5 font-mono text-text-muted">{country}</td>
                        <td className="py-1.5 text-right font-mono">{revenue}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </motion.div>
            )}
          </motion.div>
        )}
      </div>

    </div>
  );
}

export function AiAnswers() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.35 });
  const reduced = useReducedMotion() ?? false;
  const { elapsed, replay } = useTimeline(inView, reduced);

  return (
    <section aria-label="Claude and an in-app chat answering the same question from the same hypequery dataset" className="mx-auto max-w-[1280px] px-5 pb-4 pt-6 sm:px-8">
      <div ref={ref} className="grid gap-4 md:grid-cols-2">
        <ClaudeTerminal elapsed={elapsed} />
        <AppChat elapsed={elapsed} />
      </div>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={replay}
          aria-label="Replay the animation"
          className={`rounded-md p-1.5 text-text-dim transition hover:text-text ${elapsed >= DONE && !reduced ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
