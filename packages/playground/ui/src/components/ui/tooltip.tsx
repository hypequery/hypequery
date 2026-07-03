import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  className?: string;
}

/**
 * Lightweight tooltip rendered in a portal so it does not affect parent layout.
 */
export function Tooltip({
  content,
  children,
  side = 'top',
  className,
}: TooltipProps) {
  const [isVisible, setIsVisible] = React.useState(false);
  const [position, setPosition] = React.useState<{ top: number; left: number } | null>(null);
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout>>();
  const triggerRef = React.useRef<HTMLDivElement>(null);

  const updatePosition = React.useCallback(() => {
    const element = triggerRef.current;
    if (!element) return;

    const rect = element.getBoundingClientRect();
    const gap = 8;

    const nextPosition = {
      top:
        side === 'top'
          ? rect.top - gap
          : side === 'bottom'
            ? rect.bottom + gap
            : rect.top + rect.height / 2,
      left:
        side === 'left'
          ? rect.left - gap
          : side === 'right'
            ? rect.right + gap
            : rect.left + rect.width / 2,
    };

    setPosition(nextPosition);
  }, [side]);

  const showTooltip = () => {
    timeoutRef.current = setTimeout(() => {
      updatePosition();
      setIsVisible(true);
    }, 200);
  };

  const hideTooltip = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setIsVisible(false);
  };

  React.useEffect(() => {
    if (!isVisible) return;

    const handleReposition = () => updatePosition();
    window.addEventListener('scroll', handleReposition, true);
    window.addEventListener('resize', handleReposition);

    return () => {
      window.removeEventListener('scroll', handleReposition, true);
      window.removeEventListener('resize', handleReposition);
    };
  }, [isVisible, updatePosition]);

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const tooltipContent =
    isVisible && position
      ? createPortal(
          <div
            className={cn(
              'fixed z-[100] px-3 py-1.5 text-xs font-medium text-popover-foreground bg-popover border border-border rounded-md shadow-md whitespace-nowrap pointer-events-none animate-in fade-in-0 zoom-in-95',
              side === 'top' && '-translate-x-1/2 -translate-y-full',
              side === 'bottom' && '-translate-x-1/2',
              side === 'left' && '-translate-x-full -translate-y-1/2',
              side === 'right' && '-translate-y-1/2',
              className
            )}
            style={{ top: position.top, left: position.left }}
            role="tooltip"
          >
            {content}
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <div
        ref={triggerRef}
        className="inline-flex"
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        onFocus={showTooltip}
        onBlur={hideTooltip}
      >
        {children}
      </div>
      {tooltipContent}
    </>
  );
}

export default Tooltip;
