import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { Tooltip } from './tooltip';

interface SidebarContextValue {
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
  toggle: () => void;
}

const SidebarContext = React.createContext<SidebarContextValue | null>(null);

export function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider');
  }
  return context;
}

interface SidebarProviderProps {
  children: React.ReactNode;
  defaultCollapsed?: boolean;
}

export function SidebarProvider({
  children,
  defaultCollapsed = false,
}: SidebarProviderProps) {
  const [isCollapsed, setIsCollapsed] = React.useState(defaultCollapsed);

  const toggle = React.useCallback(() => {
    setIsCollapsed((prev) => !prev);
  }, []);

  return (
    <SidebarContext.Provider value={{ isCollapsed, setIsCollapsed, toggle }}>
      {children}
    </SidebarContext.Provider>
  );
}

interface SidebarProps extends React.HTMLAttributes<HTMLElement> {
  collapsedWidth?: number;
  expandedWidth?: number;
}

export function Sidebar({
  className,
  children,
  collapsedWidth = 64,
  expandedWidth = 220,
  ...props
}: SidebarProps) {
  const { isCollapsed } = useSidebar();

  return (
    <aside
      className={cn(
        'flex flex-col border-r border-border bg-card transition-all duration-300 ease-in-out',
        className
      )}
      style={{ width: isCollapsed ? collapsedWidth : expandedWidth }}
      {...props}
    >
      {children}
    </aside>
  );
}

interface SidebarHeaderProps extends React.HTMLAttributes<HTMLDivElement> {}

export function SidebarHeader({ className, children, ...props }: SidebarHeaderProps) {
  const { isCollapsed } = useSidebar();

  return (
    <div
      className={cn(
        'flex items-center h-14 border-b border-border px-3',
        isCollapsed ? 'justify-center' : 'justify-between',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

interface SidebarContentProps extends React.HTMLAttributes<HTMLDivElement> {}

export function SidebarContent({ className, children, ...props }: SidebarContentProps) {
  return (
    <div className={cn('flex-1 overflow-auto p-2', className)} {...props}>
      {children}
    </div>
  );
}

interface SidebarFooterProps extends React.HTMLAttributes<HTMLDivElement> {}

export function SidebarFooter({ className, children, ...props }: SidebarFooterProps) {
  return (
    <div
      className={cn('border-t border-border p-2', className)}
      {...props}
    >
      {children}
    </div>
  );
}

interface SidebarToggleProps {
  className?: string;
}

export function SidebarToggle({ className }: SidebarToggleProps) {
  const { isCollapsed, toggle } = useSidebar();

  return (
    <Tooltip content={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} side="right">
      <Button
        variant="ghost"
        size="icon"
        onClick={toggle}
        className={cn('h-8 w-8', className)}
      >
        {isCollapsed ? (
          <ChevronRight className="h-4 w-4" />
        ) : (
          <ChevronLeft className="h-4 w-4" />
        )}
      </Button>
    </Tooltip>
  );
}

interface SidebarNavProps extends React.HTMLAttributes<HTMLElement> {}

export function SidebarNav({ className, children, ...props }: SidebarNavProps) {
  return (
    <nav className={cn('space-y-1', className)} {...props}>
      {children}
    </nav>
  );
}

interface SidebarNavItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: React.ElementType;
  isActive?: boolean;
  tooltip?: string;
}

export function SidebarNavItem({
  className,
  children,
  icon: Icon,
  isActive = false,
  tooltip,
  ...props
}: SidebarNavItemProps) {
  const { isCollapsed } = useSidebar();

  const button = (
    <button
      className={cn(
        'w-full flex items-center gap-3 rounded-md text-sm font-medium transition-colors',
        isCollapsed ? 'justify-center px-2 py-2' : 'px-3 py-2',
        isActive
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        className
      )}
      {...props}
    >
      {Icon && <Icon className="h-4 w-4 flex-shrink-0" />}
      {!isCollapsed && <span className="truncate">{children}</span>}
    </button>
  );

  if (isCollapsed && tooltip) {
    return (
      <Tooltip content={tooltip} side="right">
        {button}
      </Tooltip>
    );
  }

  return button;
}

interface SidebarGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: string;
}

export function SidebarGroup({ className, children, label, ...props }: SidebarGroupProps) {
  const { isCollapsed } = useSidebar();

  return (
    <div className={cn('mb-4', className)} {...props}>
      {label && !isCollapsed && (
        <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {label}
        </div>
      )}
      {label && isCollapsed && (
        <div className="h-px bg-border my-2" />
      )}
      {children}
    </div>
  );
}
