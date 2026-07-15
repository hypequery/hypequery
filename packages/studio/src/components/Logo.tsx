import { cn } from '@/lib/utils';

interface LogoProps {
  collapsed?: boolean;
  className?: string;
}

/**
 * hypequery logo matching the website branding.
 * Shows "> hypequery" expanded or ">" collapsed.
 */
export function Logo({ collapsed, className }: LogoProps) {
  if (collapsed) {
    return (
      <span
        className={cn(
          'font-mono tracking-[-0.02em] text-foreground',
          className
        )}
        title="hypequery"
      >
        &gt;
      </span>
    );
  }

  return (
    <span
      className={cn(
        'font-mono text-[14px] font-bold tracking-[-0.02em] text-foreground',
        className
      )}
    >
      &gt; hypequery
    </span>
  );
}

export default Logo;
