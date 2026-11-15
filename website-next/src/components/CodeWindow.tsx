import { StaticCode } from '@/components/home/StaticCode';

type CodeWindowProps = {
  code: string;
  filename: string;
  language?: string;
  className?: string;
};

// Highlighted on the server (StaticCode) so pages ship HTML, not a Shiki instance per code block.
export default async function CodeWindow({
  code,
  filename,
  language = 'typescript',
  className = '',
}: CodeWindowProps) {
  return (
    <div
      className={`overflow-hidden rounded-lg border border-border bg-bg-alt shadow-card dark:border-white/10 dark:bg-[#0d1117] ${className}`}
    >
      <div className="flex items-center gap-2 border-b border-border bg-bg-card/70 px-4 py-2.5 text-[12px] text-text-muted dark:border-white/10 dark:bg-[#0a0e16] dark:text-slate-300">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f56]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#27c93f]" />
        <span className="ml-2 font-mono text-[11px] tracking-[0.03em] text-text-dim dark:text-slate-400">{filename}</span>
      </div>
      {/* Long examples scroll inside the panel instead of stretching the page. */}
      <div className="max-h-[720px] overflow-y-auto bg-bg-alt px-4 py-4 [scrollbar-width:thin] dark:bg-[#07090F]">
        <StaticCode code={code} lang={language === 'http' ? 'javascript' : language} className="text-[13px]! leading-6!" />
      </div>
    </div>
  );
}
