import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ICON_SIZES, type IconSize } from '@/lib/colors';

interface IconButtonProps {
  icon: LucideIcon;
  onClick?: () => void;
  disabled?: boolean;
  size?: IconSize;
  title?: string;
  className?: string;
  children?: React.ReactNode;
}

/**
 * Reusable icon button with consistent styling.
 */
export function IconButton({
  icon: Icon,
  onClick,
  disabled = false,
  size = 'md',
  title,
  className,
  children,
}: IconButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'inline-flex items-center gap-2 p-1.5 rounded-md transition-colors',
        'text-muted-foreground hover:text-foreground hover:bg-muted',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        className
      )}
    >
      <Icon className={ICON_SIZES[size]} />
      {children}
    </button>
  );
}

export default IconButton;
