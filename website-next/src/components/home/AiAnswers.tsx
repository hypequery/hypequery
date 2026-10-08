'use client';

import { useEffect, useRef } from 'react';
import { motion, useInView, useReducedMotion } from 'motion/react';
import { RotateCcw, Sparkles } from 'lucide-react';
import { SiClaude } from 'react-icons/si';
import { EXCHANGES, formatUsd, sparkline, textBar, type Exchange } from './aiAnswersData';
import { useTimeline } from './useTimeline';

// Claude Code's thinking glyphs.
const SPINNER = ['·', '✢', '✳', '✶', '✻', '✽'];

// Milliseconds into each exchange. Exchanges start EXCHANGE_MS apart.
const T = {
  typePerChar: 28,
  thinking: 1300,
  tool: 2500,
  toolResult: 2900,
  answer: 3400,
  chatUser: 500,
  chatTyping: 1300,
};
const EXCHANGE_MS = 6200;
const DONE = (EXCHANGES.length - 1) * EXCHANGE_MS + T.answer + 1000;

const CLAUDE_ORANGE = 'text-[#d97757]';

const reveal = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] as const },
};

const grow = { duration: 0.7, ease: [0.22, 1, 0.36, 1] as const };

/** Time into exchange `index`, negative before it starts. */
function local(elapsed: number, index: number) {
  return elapsed - index * EXCHANGE_MS;
}

/** Changes whenever something new appears, so the panels can follow it. */
function stage(elapsed: number) {
  const marks = [0, T.chatUser, T.chatTyping, T.thinking, T.tool, T.toolResult, T.answer];
  return EXCHANGES.reduce((count, _, index) => count + marks.filter((mark) => local(elapsed, index) >= mark).length, 0);
}

/** Keeps a scrolling panel pinned to its newest content, like a real chat. */
function useFollow(key: number, reduced: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduced ? 'auto' : 'smooth' });
  }, [key, reduced]);
  return ref;
}

function TerminalChart({ exchange }: { exchange: Exchange }) {
  const values = exchange.points.map((point) => point.value);

  if (exchange.chart === 'line') {
    const first = exchange.points[0];
    const last = exchange.points[exchange.points.length - 1];
    const change = Math.round(((last.value - first.value) / first.value) * 100);
    return (
      <div className="mt-1 pl-4">
        <span className="text-[#d97757]">{sparkline(values)}</span>
        <span className="text-[#a8a29e]">  {first.label} {formatUsd(first.value)} → {last.label} {formatUsd(last.value)} </span>
        <span className="text-[#4ade80]">(+{change}%)</span>
      </div>
    );
  }

  const max = Math.max(...values);
  return (
    <div className="mt-1 pl-4">
      {exchange.points.map((point, index) => (
        <motion.div key={point.label} {...reveal} transition={{ ...reveal.transition, delay: 0.08 * (index + 1) }} className="flex gap-3 whitespace-pre">
          <span className="w-[80px] text-[#a8a29e]">{point.label}</span>
          <span className="w-[72px] text-right">{formatUsd(point.value, exchange.signed)}</span>
          <span className="text-[#d97757]">{textBar(point.value, max)}</span>
        </motion.div>
      ))}
    </div>
  );
}

function TerminalExchange({ exchange, at, glyph }: { exchange: Exchange; at: number; glyph: string }) {
  const typed = exchange.question.slice(0, Math.min(exchange.question.length, Math.floor(at / T.typePerChar)));
  const typing = typed.length < exchange.question.length;

  return (
    <div className="space-y-2">
      <div>
        <span className="text-[#a8a29e]">&gt; </span>
        {typed}
        {typing && <span className="ml-px inline-block h-[1.1em] w-[0.55em] translate-y-[3px] animate-pulse bg-[#e8e6e3]" />}
      </div>

      {at >= T.thinking && at < T.tool && (
        <div className={CLAUDE_ORANGE}>
          {glyph} <span className="text-[#d97757]/90">Thinking…</span>
        </div>
      )}

      {at >= T.tool && (
        <motion.div {...reveal}>
          <span className="text-[#4ade80]">⏺</span> <span className="font-semibold">hypequery</span> - query_dataset{' '}
          <span className="text-[#78716c]">(MCP)</span>
          {at >= T.toolResult && (
            <motion.div {...reveal} className="pl-4 text-[#a8a29e]">
              ⎿ {exchange.tool}
            </motion.div>
          )}
        </motion.div>
      )}

      {at >= T.answer && (
        <motion.div {...reveal}>
          <span>⏺</span> {exchange.heading}:
          <TerminalChart exchange={exchange} />
        </motion.div>
      )}
    </div>
  );
}

function ClaudeTerminal({ elapsed, reduced }: { elapsed: number; reduced: boolean }) {
  const ref = useFollow(stage(elapsed), reduced);
  const glyph = SPINNER[Math.floor(elapsed / 110) % SPINNER.length];

  return (
    <div className="flex h-[480px] flex-col overflow-hidden rounded-xl border border-white/10 bg-[#141413] shadow-card">
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

      <div ref={ref} className="flex-1 space-y-5 overflow-y-auto p-5 font-mono text-[11.5px] leading-6 text-[#e8e6e3] [scrollbar-width:none] sm:text-[12.5px]">
        <div className="flex items-center gap-2 rounded-md border border-[#d97757]/40 px-3 py-2 text-[#a8a29e]">
          <SiClaude className={`h-3.5 w-3.5 shrink-0 ${CLAUDE_ORANGE}`} aria-hidden="true" />
          <span><span className="text-[#e8e6e3]">Claude Code</span> · hypequery MCP connected</span>
        </div>

        {EXCHANGES.map((exchange, index) => {
          const at = local(elapsed, index);
          return at >= 0 ? <TerminalExchange key={exchange.question} exchange={exchange} at={at} glyph={glyph} /> : null;
        })}
      </div>
    </div>
  );
}

function BarChart({ exchange, reduced }: { exchange: Exchange; reduced: boolean }) {
  const max = Math.max(...exchange.points.map((point) => point.value));
  return (
    <div className="mt-3 space-y-2">
      {exchange.points.map((point, index) => (
        <div key={point.label} className="flex items-center gap-3 text-xs">
          <span className="w-6 font-mono text-text-muted">{point.label}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-border">
            <motion.div
              className="h-full rounded-full bg-accent"
              initial={reduced ? false : { width: 0 }}
              animate={{ width: `${(point.value / max) * 100}%` }}
              transition={{ ...grow, delay: 0.1 * index }}
            />
          </div>
          <span className="w-[60px] text-right font-mono text-text">{formatUsd(point.value)}</span>
        </div>
      ))}
    </div>
  );
}

function LineChart({ exchange, reduced }: { exchange: Exchange; reduced: boolean }) {
  const width = 260;
  const height = 96;
  const values = exchange.points.map((point) => point.value);
  const min = Math.min(...values) * 0.9;
  const max = Math.max(...values);
  const coords = values.map((value, index) => [
    (index / (values.length - 1)) * width,
    height - 6 - ((value - min) / (max - min)) * (height - 16),
  ]);
  const line = coords.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const [lastX, lastY] = coords[coords.length - 1];

  return (
    <div className="mt-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[96px] w-full overflow-visible" aria-hidden="true">
        <motion.path
          d={`${line} L${width} ${height} L0 ${height} Z`}
          fill="var(--accent)"
          fillOpacity={0.16}
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ ...grow, delay: 0.5 }}
        />
        <motion.path
          d={line}
          fill="none"
          className="stroke-accent"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={reduced ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1, ease: 'easeOut' }}
        />
        <motion.circle
          cx={lastX}
          cy={lastY}
          r="3.5"
          className="fill-accent"
          initial={reduced ? false : { scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ ...grow, delay: 0.9 }}
        />
      </svg>
      <div className="mt-1.5 flex justify-between font-mono text-[10px] text-text-dim">
        {exchange.points.map((point) => <span key={point.label}>{point.label}</span>)}
      </div>
    </div>
  );
}

function ColumnChart({ exchange, reduced }: { exchange: Exchange; reduced: boolean }) {
  const max = Math.max(...exchange.points.map((point) => point.value));
  return (
    <div className="mt-3 flex h-[120px] items-end gap-4">
      {exchange.points.map((point, index) => (
        <div key={point.label} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
          <span className="font-mono text-[11px] text-text">{formatUsd(point.value, exchange.signed)}</span>
          <motion.div
            className="w-full max-w-[44px] rounded-t-md bg-accent"
            initial={reduced ? false : { height: 0 }}
            animate={{ height: `${(point.value / max) * 64}px` }}
            transition={{ ...grow, delay: 0.1 * index }}
          />
          <span className="text-[10px] text-text-muted">{point.label}</span>
        </div>
      ))}
    </div>
  );
}

function ChatChart({ exchange, reduced }: { exchange: Exchange; reduced: boolean }) {
  if (exchange.chart === 'line') return <LineChart exchange={exchange} reduced={reduced} />;
  if (exchange.chart === 'columns') return <ColumnChart exchange={exchange} reduced={reduced} />;
  return <BarChart exchange={exchange} reduced={reduced} />;
}

function ChatExchange({ exchange, at, reduced }: { exchange: Exchange; at: number; reduced: boolean }) {
  const typing = at >= T.chatTyping && at < T.answer;

  return (
    <>
      {at >= T.chatUser && (
        <motion.div {...reveal} className="flex items-end justify-end gap-2">
          <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-accent px-4 py-2.5 text-sm text-white dark:text-[#0c0e14]">{exchange.question}</div>
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-bg-alt text-[10px] font-medium text-text-muted">JD</span>
        </motion.div>
      )}

      {(typing || at >= T.answer) && (
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
            <motion.div {...reveal} className="w-[85%] max-w-[340px] rounded-2xl rounded-bl-sm border border-border bg-bg-alt/60 px-4 py-3 text-sm text-text">
              {exchange.reply.lead}
              <strong className="font-semibold">{exchange.reply.strong}</strong>
              {exchange.reply.tail}
              <ChatChart exchange={exchange} reduced={reduced} />
            </motion.div>
          )}
        </motion.div>
      )}
    </>
  );
}

function AppChat({ elapsed, reduced }: { elapsed: number; reduced: boolean }) {
  const ref = useFollow(stage(elapsed), reduced);

  return (
    <div className="flex h-[480px] flex-col overflow-hidden rounded-xl border border-border bg-bg-card shadow-card">
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-text text-[11px] font-semibold text-bg">A</span>
        <span className="text-xs font-medium text-text">Acme Analytics</span>
      </div>

      <div ref={ref} className="flex flex-1 flex-col gap-4 overflow-y-auto p-5 [scrollbar-width:none]">
        {EXCHANGES.map((exchange, index) => {
          const at = local(elapsed, index);
          return at >= 0 ? <ChatExchange key={exchange.question} exchange={exchange} at={at} reduced={reduced} /> : null;
        })}
      </div>
    </div>
  );
}

export function AiAnswers() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.35 });
  const reduced = useReducedMotion() ?? false;
  const { elapsed, replay } = useTimeline(inView, reduced, DONE);

  return (
    <section aria-label="Claude and an in-app chat answering the same questions from the same hypequery dataset" className="mx-auto max-w-[1280px] px-5 pb-4 pt-6 sm:px-8">
      <div ref={ref} className="grid gap-4 md:grid-cols-2">
        <ClaudeTerminal elapsed={elapsed} reduced={reduced} />
        <AppChat elapsed={elapsed} reduced={reduced} />
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
