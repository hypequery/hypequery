import CodeHighlight from '@/components/CodeHighlight';

type CodeWindowProps = {
  code: string;
  filename: string;
  language?: string;
  className?: string;
};

export default function CodeWindow({
  code,
  filename,
  language = 'typescript',
  className = '',
}: CodeWindowProps) {
  return (
    <div
      className={`overflow-hidden border border-white/10 bg-[#0d1117] shadow-[0_24px_70px_rgba(2,6,23,0.45)] ${className}`}
    >
      <div className="flex items-center gap-2 border-b border-white/10 bg-[#0a0e16] px-4 py-2.5 text-[12px] text-slate-300">
        <span className="h-2.5 w-2.5 rounded-full bg-slate-600" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-600" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-600" />
        <span className="ml-2 font-mono text-[11px] tracking-[0.03em] text-slate-400">{filename}</span>
      </div>
      <div className="bg-[#07090F] px-4 pb-4">
        <CodeHighlight code={code} language={language} />
      </div>
    </div>
  );
}
