import { SiClaude, SiGooglegemini, SiMistralai } from 'react-icons/si';
import { FeatureCard, FeatureCardCopy } from './FeatureCard';

export function AgentFeatureCard() {
  return (
    <FeatureCard number="03" animationDelay={140}>
      <div className="mt-7"><FeatureCardCopy title="Give agents better answers" description="Expose governed datasets through MCP without giving agents raw SQL access." /></div>
      <div className="relative mt-auto h-16 shrink-0 pt-3" role="img" aria-label="Analytics chat with Claude, Gemini, and Mistral">
        <svg className="absolute bottom-0 right-0 h-14 w-36" viewBox="0 0 144 56" fill="none" aria-hidden="true">
          <path d="M10 1h124a9 9 0 0 1 9 9v31a9 9 0 0 1-9 9H55l-13 5v-5H10a9 9 0 0 1-9-9V10a9 9 0 0 1 9-9Z" fill="var(--bg-card)" stroke="var(--border-strong)" />
          <path d="M12 11h48M12 17h31" stroke="var(--accent-hi)" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <div className="absolute bottom-2 right-3 flex items-center gap-1.5">
          <span title="Claude" className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-bg-card text-[#d97757]"><SiClaude className="h-4 w-4" aria-hidden="true" /></span>
          <span title="Gemini" className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-bg-card text-[#4285f4]"><SiGooglegemini className="h-4 w-4" aria-hidden="true" /></span>
          <span title="Mistral" className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-bg-card text-[#ff7000]"><SiMistralai className="h-4 w-4" aria-hidden="true" /></span>
        </div>
      </div>
    </FeatureCard>
  );
}
