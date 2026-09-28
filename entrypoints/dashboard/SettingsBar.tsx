import { useState } from 'react';
import {
  Bell,
  BellOff,
  Download,
  Eraser,
  Eye,
  EyeOff,
  HelpCircle,
  Leaf,
  Link2,
  SlidersHorizontal,
  Upload,
  Zap,
  Database,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { formatDurationShort } from '@/lib/duration';

type GroupId = 'dashboard' | 'automation' | 'quicklinks' | 'data' | 'help';

const GROUPS: { id: GroupId; label: string; icon: React.ReactNode }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <SlidersHorizontal size={20} /> },
  { id: 'automation', label: 'Automation', icon: <Zap size={20} /> },
  { id: 'quicklinks', label: 'Quick links', icon: <Link2 size={20} /> },
  { id: 'data', label: 'Your data', icon: <Database size={20} /> },
  { id: 'help', label: 'Help', icon: <HelpCircle size={20} /> },
];

/** The controls of one group. Every group stays mounted so a file picker or
 * dialog inside it is not torn down; only the open one is visible. */
function GroupPanel({
  id,
  open,
  children,
}: {
  id: GroupId;
  open: GroupId | null;
  children: React.ReactNode;
}) {
  return (
    <div
      id={`settings-group-${id}`}
      role="region"
      aria-label={GROUPS.find((g) => g.id === id)?.label}
      className={open === id ? 'flex flex-wrap gap-2' : 'hidden'}
    >
      {children}
    </div>
  );
}

function Chip({
  icon,
  label,
  state,
  active,
  tone = 'primary',
  title,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  state?: string;
  active?: boolean;
  tone?: 'primary' | 'amber' | 'green';
  title: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const activeClass = {
    amber: 'border-amber-400 bg-amber-400 text-amber-950 hover:bg-amber-300',
    green: 'border-emerald-400 bg-emerald-400 text-emerald-950 hover:bg-emerald-300',
    primary: 'border-primary bg-primary text-primary-foreground hover:opacity-90',
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 ${
        active ? activeClass : 'border-border bg-transparent hover:bg-muted'
      }`}
    >
      {icon}
      <span>{label}</span>
      {state && (
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ${
            active ? 'bg-black/15' : 'bg-muted text-muted-foreground'
          }`}
        >
          {state}
        </span>
      )}
    </button>
  );
}

export function SettingsBar({
  open,
  hoverPeekEnabled,
  onToggleHoverPeek,
  lazyRestoreEnabled,
  onToggleLazyRestore,
  nudgeEnabled,
  nudgeIntervalMinutes,
  onOpenNudgeSettings,
  quickLinksEnabled,
  onToggleQuickLinks,
  onClearVisitHistory,
  hiddenSites,
  onUnhideSite,
  canExport,
  onExportAll,
  onImportFile,
  onOpenTutorial,
  className,
}: {
  open: boolean;
  hoverPeekEnabled: boolean;
  onToggleHoverPeek: () => void;
  lazyRestoreEnabled: boolean;
  onToggleLazyRestore: () => void;
  nudgeEnabled: boolean;
  nudgeIntervalMinutes: number;
  onOpenNudgeSettings: () => void;
  quickLinksEnabled: boolean;
  onToggleQuickLinks: () => void;
  onClearVisitHistory: () => void;
  hiddenSites: string[];
  onUnhideSite: (domain: string) => void;
  canExport: boolean;
  onExportAll: () => void;
  onImportFile: (file: File) => void;
  onOpenTutorial: () => void;
  className?: string;
}) {
  const [openGroup, setOpenGroup] = useState<GroupId | null>(null);

  return (
    <div
      className={`grid transition-[grid-template-rows,margin] duration-200 ease-out ${
        open ? 'mb-6 grid-rows-[1fr]' : 'mb-0 grid-rows-[0fr]'
      } ${className ?? ''}`}
      aria-hidden={!open}
      inert={!open}
    >
      <div className="min-h-0 overflow-hidden">
        <div className="rounded-2xl border border-border bg-card p-3 shadow-sm">
          <div className="flex flex-wrap justify-center gap-2">
            {GROUPS.map((group) => {
              const active = openGroup === group.id;
              return (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => setOpenGroup(active ? null : group.id)}
                  aria-expanded={active}
                  aria-controls={`settings-group-${group.id}`}
                  title={group.label}
                  className={`flex w-24 flex-col items-center gap-1 rounded-xl px-3 py-2 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary ${
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  {group.icon}
                  {group.label}
                </button>
              );
            })}
          </div>

          <div
            className={`grid transition-[grid-template-rows,margin] duration-200 ease-out ${
              openGroup ? 'mt-3 grid-rows-[1fr]' : 'mt-0 grid-rows-[0fr]'
            }`}
          >
            <div className="min-h-0 overflow-hidden">
              <div className="border-t border-border pt-3">
          <GroupPanel id="dashboard" open={openGroup}>
          <Chip
            icon={hoverPeekEnabled ? <Eye size={15} /> : <EyeOff size={15} />}
            label="Hover peek"
            state={hoverPeekEnabled ? 'On' : 'Off'}
            active={hoverPeekEnabled}
            title="Hover over a card to peek its tabs"
            onClick={onToggleHoverPeek}
          />
          <Chip
            icon={<Leaf size={15} />}
            label="Lazy loading"
            state={lazyRestoreEnabled ? 'On' : 'Off'}
            active={lazyRestoreEnabled}
            tone="green"
            title={
              lazyRestoreEnabled
                ? 'Opening a snapshot loads only the first tab; the rest wait until you click Load on them'
                : 'Opening a snapshot loads every tab'
            }
            onClick={onToggleLazyRestore}
          />
          </GroupPanel>

          <GroupPanel id="automation" open={openGroup}>
          <Chip
            icon={nudgeEnabled ? <Bell size={15} /> : <BellOff size={15} />}
            label="Nudges"
            state={nudgeEnabled ? `Every ${formatDurationShort(nudgeIntervalMinutes)}` : 'Off'}
            active={nudgeEnabled}
            tone="amber"
            title="Tab nudges: how often, and how old is stale"
            onClick={onOpenNudgeSettings}
          />
          </GroupPanel>

          <GroupPanel id="quicklinks" open={openGroup}>
          <Chip
            icon={<Link2 size={15} />}
            label="Quick links"
            state={quickLinksEnabled ? 'On' : 'Off'}
            active={quickLinksEnabled}
            title={
              quickLinksEnabled
                ? 'Shows your most visited sites at the top. Turn off to stop counting visits and hide the row'
                : 'Quick links are off: no visits are counted and the row is hidden'
            }
            onClick={onToggleQuickLinks}
          />


          {hiddenSites.length > 0 && (
            <Dialog>
              <DialogTrigger asChild>
                <button
                  type="button"
                  title="Sites you hid from Quick links"
                  className="inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-border px-3.5 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
                >
                  <EyeOff size={15} />
                  <span>Hidden sites</span>
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold leading-none text-muted-foreground">
                    {hiddenSites.length}
                  </span>
                </button>
              </DialogTrigger>
              <DialogContent className="max-w-sm">
                <DialogHeader>
                  <DialogTitle>Hidden sites</DialogTitle>
                  <DialogDescription>
                    These sites won't show up in your most visited row. Unhide one to bring it back.
                  </DialogDescription>
                </DialogHeader>
                <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
                  {hiddenSites.map((domain) => (
                    <li
                      key={domain}
                      className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2"
                    >
                      <span className="truncate text-sm font-medium">{domain}</span>
                      <Button size="sm" variant="outline" onClick={() => onUnhideSite(domain)}>
                        Unhide
                      </Button>
                    </li>
                  ))}
                </ul>
              </DialogContent>
            </Dialog>
          )}

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                type="button"
                title="Forget which sites you visit most"
                className="inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-border px-3.5 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
              >
                <Eraser size={15} />
                <span>Clear visit history</span>
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear your visit history?</AlertDialogTitle>
                <AlertDialogDescription>
                  TabBuddy will forget everything it has learned about which sites you visit,
                  including scores and any hidden sites. To just bring back one hidden site, use
                  Hidden sites instead. Sites you added to Quick links yourself are kept, and your
                  snapshots aren't touched.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onClearVisitHistory}>Clear</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          </GroupPanel>

          <GroupPanel id="data" open={openGroup}>
          <Chip
            icon={<Download size={15} />}
            label="Export all"
            title="Download every snapshot as a JSON file"
            onClick={onExportAll}
            disabled={!canExport}
          />
          <label className="inline-flex flex-1">
            <span
              title="Import snapshots from a JSON file"
              className="inline-flex flex-1 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full border border-border px-3.5 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
            >
              <Upload size={15} />
              Import
            </span>
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onImportFile(file);
                e.target.value = '';
              }}
            />
          </label>


          </GroupPanel>

          <GroupPanel id="help" open={openGroup}>
          <Chip
            icon={<HelpCircle size={15} />}
            label="Tutorial"
            title="Replay the welcome tour"
            onClick={onOpenTutorial}
          />
          </GroupPanel>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
