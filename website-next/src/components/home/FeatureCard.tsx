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

export function FeatureCardCopy({
  title,
  description,
  large = false,
}: {
  title: string;
  description: string;
  large?: boolean;
}) {
  return (
    <>
      <h2 className={`${large ? 'text-[30px]' : 'text-[22px]'} font-normal leading-tight tracking-[-0.03em] text-text`}>{title}</h2>
      <p className="mt-1 text-sm leading-5 text-text-muted">{description}</p>
    </>
  );
}
