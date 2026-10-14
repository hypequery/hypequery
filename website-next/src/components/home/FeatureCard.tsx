import type { ReactNode } from 'react';

export function FeatureCard({
  number,
  animationDelay,
  topRight,
  className = '',
  children,
}: {
  number: string;
  animationDelay: number;
  topRight?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <article
      className={`hero-feature-card flex min-w-0 flex-col rounded-xl border border-border bg-bg-alt/50 p-4 shadow-card ${className}`}
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-accent">{number}</span>
        {topRight}
      </div>
      {children}
    </article>
  );
}
