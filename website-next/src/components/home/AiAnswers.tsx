'use client';

import { motion, useInView, useReducedMotion } from 'motion/react';
import { ArrowUp, Sparkles } from 'lucide-react';
import { SiClaude } from 'react-icons/si';
import { Clawd } from './Clawd';
import { EXCHANGES, formatUsd, type Exchange } from './aiAnswersData';
import { useFollow } from './useFollow';
import { useTimeline } from './useTimeline';

// Claude Code's thinking glyphs.
const SPINNER = ['·', '✢', '✳', '✶', '✻', '✽'];

// Milliseconds into each exchange. Exchanges start EXCHANGE_MS apart.
const T = {
  typePerChar: 28,
  // Both sides type the question into their input, then send it.
  send: 1300,
  thinking: 1500,
  tool: 2500,
  toolResult: 2900,
  answer: 3400,
  chatTyping: 1700,
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
  const marks = [0, T.send, T.chatTyping, T.thinking, T.tool, T.toolResult, T.answer];
  return EXCHANGES.reduce((count, _, index) => count + marks.filter((mark) => local(elapsed, index) >= mark).length, 0);
}

/** The question currently being typed into the inputs, before it is sent. */
function currentDraft(elapsed: number) {
  for (const [index, exchange] of EXCHANGES.entries()) {
    const at = local(elapsed, index);
    if (at >= 0 && at < T.send) return exchange.question.slice(0, Math.floor(at / T.typePerChar));
  }
  return null;
}

/** Claude Code prints plain text, so the answer is rows and a summary line. */
function TerminalRows({ exchange }: { exchange: Exchange }) {
  return (
    <div className="mt-1 pl-4">
      {exchange.points.map((point, index) => (
        <motion.div key={point.label} {...reveal} transition={{ ...reveal.transition, delay: 0.06 * (index + 1) }} className="flex max-w-[240px] justify-between">
          <span className="text-[#a8a29e]">{point.label}</span>
          <span>{formatUsd(point.value, exchange.signed)}</span>
        </motion.div>
      ))}
      <div className="mt-2 text-[#a8a29e]">
        {exchange.reply.lead}
        <span className="font-semibold text-[#e8e6e3]">{exchange.reply.strong}</span>
        {exchange.reply.tail}
      </div>
    </div>
  );
}

function TerminalExchange({ exchange, at, glyph }: { exchange: Exchange; at: number; glyph: string }) {
  if (at < T.send) return null;

  return (
    <div className="space-y-2">
      <div className="text-[#a8a29e]">&gt; {exchange.question}</div>

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
          <TerminalRows exchange={exchange} />
        </motion.div>
      )}
    </div>
  );
}

type PanelProps = { elapsed: number; reduced: boolean; className?: string };

export function ClaudeTerminal({ elapsed, reduced, className = 'h-[480px]' }: PanelProps) {
  const ref = useFollow(stage(elapsed), reduced);
  const glyph = SPINNER[Math.floor(elapsed / 110) % SPINNER.length];
  const draft = currentDraft(elapsed) ?? '';

  return (
    <div className={`flex flex-col overflow-hidden rounded-xl border border-white/10 bg-[#141413] shadow-card ${className}`}>
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

      <div className="flex min-h-0 flex-1 flex-col font-mono text-[11.5px] leading-6 text-[#e8e6e3] sm:text-[12.5px]">
        {/* A terminal fills from the bottom, just above the prompt. */}
        <div ref={ref} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pt-5 [scrollbar-width:none]">
          <div className="mt-auto space-y-5">
            {/* Claude Code's welcome banner. */}
            <div className="flex items-center gap-4">
              <Clawd className={`h-[30px] w-12 shrink-0 ${CLAUDE_ORANGE}`} />
              <div className="leading-5">
                <div className="font-semibold">Claude Code</div>
                <div className="text-[#a8a29e]">hypequery MCP connected</div>
                <div className="text-[#a8a29e]">~/acme-analytics</div>
              </div>
            </div>

            {EXCHANGES.map((exchange, index) => (
              <TerminalExchange key={exchange.question} exchange={exchange} at={local(elapsed, index)} glyph={glyph} />
            ))}
          </div>
        </div>

        <div className="px-4 pb-3 pt-4">
          <div className="rounded-md border border-[#78716c]/70 px-3 py-1.5">
            <span className="text-[#a8a29e]">&gt; </span>
            {draft}
            <span className="ml-px inline-block h-[1.1em] w-[0.55em] translate-y-[3px] bg-[#e8e6e3]/80" />
          </div>
          <div className="mt-1 px-3 text-[10.5px] text-[#78716c]">? for shortcuts</div>
        </div>
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
      {at >= T.send && (
        <motion.div {...reveal} className="flex justify-end">
          <div className="max-w-[80%] rounded-2xl rounded-br-md bg-bg-alt px-4 py-2.5 text-sm text-text">{exchange.question}</div>
        </motion.div>
      )}

      {(typing || at >= T.answer) && (
        <motion.div {...reveal} className="flex items-start gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft">
            <Sparkles className="h-3 w-3 text-accent" aria-hidden="true" />
          </span>
          {typing ? (
            <div className="flex h-6 items-center gap-1" aria-label="Assistant is typing">
              {[0, 1, 2].map((dot) => (
                <span key={dot} className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-dim" style={{ animationDelay: `${dot * 120}ms` }} />
              ))}
            </div>
          ) : (
            <div className="min-w-0 flex-1 pt-0.5 text-sm leading-6 text-text">
              {exchange.reply.lead}
              <strong className="font-semibold">{exchange.reply.strong}</strong>
              {exchange.reply.tail}
              <motion.div {...reveal} className="mt-3 max-w-[360px] rounded-xl border border-border bg-bg px-4 pb-4 pt-3">
                <div className="text-[11px] text-text-dim">{exchange.heading}</div>
                <ChatChart exchange={exchange} reduced={reduced} />
              </motion.div>
            </div>
          )}
        </motion.div>
      )}
    </>
  );
}

function ChatInput({ elapsed }: { elapsed: number }) {
  const typed = currentDraft(elapsed);
  const drafting = typed !== null;
  const draft = typed ?? '';

  return (
    <div className="px-4 pb-4 pt-2">
      <div className="flex items-center gap-2 rounded-xl border border-border-strong bg-bg py-2 pl-4 pr-2 text-sm shadow-card">
        <span className={`min-w-0 flex-1 truncate ${draft ? 'text-text' : 'text-text-dim'}`}>
          {draft || 'Ask about your data…'}
          {drafting && <span className="ml-px inline-block h-[1em] w-px translate-y-[2px] animate-pulse bg-text" />}
        </span>
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors ${draft ? 'bg-accent text-white dark:text-[#0c0e14]' : 'bg-bg-alt text-text-dim'}`}>
          <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      </div>
    </div>
  );
}

export function AppChat({ elapsed, reduced, className = 'h-[480px]' }: PanelProps) {
  const ref = useFollow(stage(elapsed), reduced);

  return (
    <div className={`flex flex-col overflow-hidden rounded-xl border border-border bg-bg-card shadow-card ${className}`}>
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-text text-[11px] font-semibold text-bg">A</span>
        <span className="text-xs font-medium text-text">Acme Analytics</span>
      </div>

      <div ref={ref} className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 pb-2 pt-5 [scrollbar-width:none]">
        {EXCHANGES.map((exchange, index) => {
          const at = local(elapsed, index);
          return at >= 0 ? <ChatExchange key={exchange.question} exchange={exchange} at={at} reduced={reduced} /> : null;
        })}
      </div>

      <ChatInput elapsed={elapsed} />
    </div>
  );
}

/** One shared clock, so the terminal and the chat ask each question together. Starts when `ref` scrolls into view. */
export function useAiAnswers(ref: React.RefObject<HTMLElement | null>) {
  const inView = useInView(ref, { once: true, amount: 0.3 });
  const reduced = useReducedMotion() ?? false;
  const { elapsed, replay } = useTimeline(inView, reduced, DONE);
  return { elapsed, reduced, replay, done: elapsed >= DONE && !reduced };
}
