import { ChevronDown, Code, Database, List, MessageSquare, Plug, Settings } from 'lucide-react';

// The hypequery Cloud app chrome from the chat redesign: a 60px icon rail and a 52px header.

export type CloudPage = 'chat' | 'api' | 'model' | 'logs' | 'settings';

const NAV = [
  ['chat', MessageSquare, 'Chat'],
  ['api', Code, 'API'],
  ['model', Database, 'Data Model'],
  ['logs', List, 'Logs'],
] as const;

export function CloudLogo() {
  return <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-text text-[15px] font-bold text-bg">h</span>;
}

function RailItem({ active, label, children }: { active: boolean; label: string; children: React.ReactNode }) {
  return (
    <span
      title={label}
      className={`flex h-11 w-11 items-center justify-center rounded-[10px] ${active ? 'bg-accent text-white dark:text-[#0c0e14]' : 'text-text-muted'}`}
    >
      {children}
    </span>
  );
}

export function CloudRail({ page, className = '' }: { page: CloudPage | null; className?: string }) {
  return (
    <nav aria-hidden="true" className={`flex w-[60px] shrink-0 flex-col items-center gap-1.5 border-r border-border bg-bg-alt py-3.5 ${className}`}>
      <span className="mb-3.5">
        <CloudLogo />
      </span>
      {NAV.map(([id, Icon, label]) => (
        <RailItem key={id} active={page === id} label={label}>
          <Icon className="h-5 w-5" strokeWidth={1.75} />
        </RailItem>
      ))}
      <span className="flex-1" />
      <RailItem active={page === 'settings'} label="Settings">
        <Settings className="h-5 w-5" strokeWidth={1.75} />
      </RailItem>
      <span className="mt-1.5 flex h-[30px] w-[30px] items-center justify-center rounded-full bg-border text-[12px] font-semibold text-accent">LR</span>
    </nav>
  );
}

/** The version switcher: an amber dot for a draft, a green dot for live Published, grey before anything is live. */
export function VersionSwitch({ draft, name, detail, live = true }: { draft: boolean; name: string; detail: string; live?: boolean }) {
  return (
    <span className="inline-flex h-8 shrink-0 items-center gap-[7px] rounded-[7px] px-2 text-[13px] font-medium text-text">
      <span className={`h-[7px] w-[7px] rounded-full ${draft ? 'bg-[#b45309]' : live ? 'bg-[#16a34a]' : 'bg-text-dim'}`} />
      <span className={draft ? 'font-mono' : ''}>{name}</span>
      <span className="font-normal text-text-muted">{detail}</span>
      <ChevronDown className="h-3 w-3 text-text-muted" strokeWidth={2} />
    </span>
  );
}

export function Slash({ className = '' }: { className?: string }) {
  return <span className={`text-text-dim ${className}`}>/</span>;
}

export function ConnectButton() {
  return (
    <span className="inline-flex h-8 shrink-0 items-center gap-[7px] rounded-[7px] border border-border-strong bg-bg-card px-3 text-[13px] font-medium text-text">
      <Plug className="h-3.5 w-3.5" strokeWidth={2} />
      Connect
    </span>
  );
}

/**
 * The 52px header. `logo` puts the mark here when there is no rail: always, or only on small screens.
 * `innerClassName` can narrow the content, so actions stay in view in a window that runs off the page.
 */
export function CloudHeader({
  logo = false,
  innerClassName = '',
  children,
  actions,
}: {
  logo?: boolean | 'mobile';
  innerClassName?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="h-[52px] shrink-0 border-b border-border bg-bg-card px-4">
      <div className={`flex h-full items-center gap-2.5 ${innerClassName}`}>
        {logo && (
          <span className={logo === 'mobile' ? 'md:hidden' : undefined}>
            <CloudLogo />
          </span>
        )}
        <span className="text-[13px] font-semibold text-text">analytics</span>
        <Slash />
        <span className="flex min-w-0 items-center gap-2.5 overflow-hidden">{children}</span>
        <span className="flex-1" />
        {actions}
      </div>
    </header>
  );
}
