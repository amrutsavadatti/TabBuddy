import { Bell, BellOff, Download, Eye, EyeOff, HelpCircle, Leaf, Upload } from 'lucide-react';
import { formatDurationShort } from '@/lib/duration';

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
  canExport: boolean;
  onExportAll: () => void;
  onImportFile: (file: File) => void;
  onOpenTutorial: () => void;
  className?: string;
}) {
  return (
    <div
      className={`grid transition-[grid-template-rows,margin] duration-200 ease-out ${
        open ? 'mb-6 grid-rows-[1fr]' : 'mb-0 grid-rows-[0fr]'
      } ${className ?? ''}`}
      aria-hidden={!open}
      inert={!open}
    >
      <div className="min-h-0 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3 shadow-sm">
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
                ? 'Opening a snapshot loads only the first tab; the rest load when you switch to them'
                : 'Opening a snapshot loads every tab'
            }
            onClick={onToggleLazyRestore}
          />
          <Chip
            icon={nudgeEnabled ? <Bell size={15} /> : <BellOff size={15} />}
            label="Nudges"
            state={nudgeEnabled ? `Every ${formatDurationShort(nudgeIntervalMinutes)}` : 'Off'}
            active={nudgeEnabled}
            tone="amber"
            title="Tab nudges: how often, and how old is stale"
            onClick={onOpenNudgeSettings}
          />


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


          <Chip
            icon={<HelpCircle size={15} />}
            label="Tutorial"
            title="Replay the welcome tour"
            onClick={onOpenTutorial}
          />
        </div>
      </div>
    </div>
  );
}
