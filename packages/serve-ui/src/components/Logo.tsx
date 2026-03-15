import { cn } from '@/lib/utils';

interface LogoProps {
  collapsed?: boolean;
  className?: string;
}

/**
 * HypeQuery logo matching the website branding.
 * Shows "> hypequery" expanded or ">" collapsed.
 */
export function Logo({ collapsed, className }: LogoProps) {
  if (collapsed) {
    return (
      <span
        className={cn(
          'font-mono text-xl font-bold text-primary',
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
        'font-mono text-lg font-bold',
        className
      )}
    >
      <span className="text-primary">&gt;</span>{' '}
      <span className="text-foreground">hypequery</span>
    </span>
  );
}

export default Logo;
