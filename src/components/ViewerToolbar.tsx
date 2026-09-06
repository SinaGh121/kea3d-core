import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Toolbar } from 'radix-ui';
import { Ellipsis } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { sideWorkspaceWidth } from './viewerLayout';

export interface ViewerAction {
  id: string;
  label: string;
  shortLabel?: string;
  group: 'Navigate' | 'Inspect' | 'Appearance' | 'Output' | 'Application';
  priority: number;
  icon: ReactNode;
  available?: boolean;
  disabledReason?: string;
  active?: boolean;
  shortcut?: string;
  run: () => void;
}

const groups: ViewerAction['group'][] = ['Navigate', 'Inspect', 'Appearance', 'Output', 'Application'];

export function ViewerToolbar({ actions, compact, bottom, sideWorkspace, open, onOpenChange }: {
  actions: ViewerAction[];
  compact: boolean;
  bottom: string | number;
  sideWorkspace: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const available = actions.filter((action) => action.available !== false);
  const capacity = Math.max(1, Math.floor((width - 10) / 48) - 1);
  const pinned = [...available].sort((a, b) => a.priority - b.priority)
    .slice(0, Math.min(compact ? 5 : available.length, capacity));
  const overflow = available.filter((action) => !pinned.some((item) => item.id === action.id));
  const invoke = (action: ViewerAction) => { onOpenChange(false); action.run(); };
  const renderAction = (action: ViewerAction, tile = false) => (
    <Toolbar.Button key={action.id} asChild disabled={!!action.disabledReason}>
      <Button variant="ghost" aria-label={action.label} aria-pressed={action.active}
        aria-keyshortcuts={action.shortcut} disabled={!!action.disabledReason}
        title={action.disabledReason ?? action.label}
        className={tile ? 'h-16 min-w-11 w-full flex-col gap-1 px-1 text-[11px] leading-tight whitespace-normal' : 'size-11 shrink-0 p-0'}
        onClick={() => invoke(action)}>
        {action.icon}
        {tile && <span>{action.shortLabel ?? action.label}</span>}
      </Button>
    </Toolbar.Button>
  );
  return (
    <div ref={container} className="pointer-events-none absolute z-45 flex justify-center"
      style={compact
        ? { left: 8, right: sideWorkspace ? `calc(${sideWorkspaceWidth} + 8px)` : 8, bottom: sideWorkspace || bottom === 0 ? 8 : `calc(${bottom} + 8px)` }
        : { top: 20, left: 400, right: 20 }}>
      <Toolbar.Root loop aria-label={compact ? 'Mobile viewer tools' : 'Viewer tools'}
        className="pointer-events-auto flex max-w-full items-center gap-1 rounded-xl border bg-card p-1 shadow-lg">
        {pinned.map((action) => (
          <Tooltip key={action.id}>
            <TooltipTrigger asChild>{renderAction(action)}</TooltipTrigger>
            <TooltipContent>{action.disabledReason ?? action.label}{action.shortcut && ` (${action.shortcut})`}</TooltipContent>
          </Tooltip>
        ))}
        {overflow.length > 0 && <Popover open={open} onOpenChange={onOpenChange}>
          <PopoverTrigger asChild>
            <Toolbar.Button asChild><Button variant="ghost" aria-label="More tools" className="size-11 shrink-0 p-0"><Ellipsis /></Button></Toolbar.Button>
          </PopoverTrigger>
          <PopoverContent aria-label="More viewer tools" side={compact ? 'top' : 'bottom'} align="end" sideOffset={8}
            className="max-h-[min(65dvh,var(--radix-popover-content-available-height))] w-[min(360px,calc(100vw-24px))] overflow-y-auto overscroll-contain rounded-xl p-2">
            <Toolbar.Root loop aria-label="More viewer tools" orientation="vertical" className="grid gap-2">
              {groups.filter((group) => overflow.some((action) => action.group === group)).map((group) => (
                <section key={group} aria-label={group}>
                  <h3 className="px-2 py-1 text-xs font-medium text-muted-foreground">{group}</h3>
                  <div className="grid grid-cols-3 gap-1">{overflow.filter((action) => action.group === group).map((action) => renderAction(action, true))}</div>
                </section>
              ))}
            </Toolbar.Root>
          </PopoverContent>
        </Popover>}
      </Toolbar.Root>
    </div>
  );
}
