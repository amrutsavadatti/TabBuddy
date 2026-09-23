import { useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DURATION_UNITS,
  fromMinutes,
  toMinutes,
  type DurationUnit,
} from '@/lib/duration';

type TabId = 'frequency' | 'stale';

const TABS: { id: TabId; label: string; description: string }[] = [
  {
    id: 'frequency',
    label: 'How often',
    description: 'How often TabBuddy checks for stale tabs and nudges you about one.',
  },
  {
    id: 'stale',
    label: 'How old is stale',
    description: 'A tab counts as stale once you haven\'t opened it for this long.',
  },
];

interface DraftDuration {
  value: string;
  unit: DurationUnit;
}

function toDraft(minutes: number): DraftDuration {
  const { value, unit } = fromMinutes(minutes);
  return { value: String(value), unit };
}

function draftToMinutes(draft: DraftDuration): number | null {
  const value = Number(draft.value);
  if (!Number.isInteger(value) || value < 1) return null;
  return toMinutes(value, draft.unit);
}

function DurationField({
  draft,
  onChange,
}: {
  draft: DraftDuration;
  onChange: (draft: DraftDuration) => void;
}) {
  const invalid = draftToMinutes(draft) === null;
  return (
    <div className="flex flex-col gap-3">
      <input
        type="number"
        min={1}
        step={1}
        inputMode="numeric"
        value={draft.value}
        onChange={(e) => onChange({ ...draft, value: e.target.value })}
        aria-invalid={invalid}
        className={`h-14 w-full rounded-xl border bg-background px-4 text-center text-3xl font-semibold tabular-nums outline-none focus:ring-2 focus:ring-primary ${
          invalid ? 'border-destructive' : 'border-border'
        }`}
      />
      <div className="grid grid-cols-3 gap-1 rounded-full bg-muted p-1">
        {DURATION_UNITS.map((u) => (
          <button
            key={u.id}
            type="button"
            onClick={() => onChange({ ...draft, unit: u.id })}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              draft.unit === u.id
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {u.label}
          </button>
        ))}
      </div>
      {invalid && (
        <p className="text-center text-xs text-destructive">Enter a whole number of 1 or more.</p>
      )}
    </div>
  );
}

export function NudgeSettingsDialog({
  open,
  onOpenChange,
  enabled,
  onEnabledChange,
  intervalMinutes,
  staleMinutes,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  intervalMinutes: number;
  staleMinutes: number;
  onSave: (values: { intervalMinutes: number; staleMinutes: number }) => void;
}) {
  const [tab, setTab] = useState<TabId>('frequency');
  const [interval, setInterval] = useState<DraftDuration>(() => toDraft(intervalMinutes));
  const [stale, setStale] = useState<DraftDuration>(() => toDraft(staleMinutes));

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setInterval(toDraft(intervalMinutes));
      setStale(toDraft(staleMinutes));
      setTab('frequency');
    }
    onOpenChange(next);
  };

  const intervalResult = draftToMinutes(interval);
  const staleResult = draftToMinutes(stale);
  const canSave = intervalResult !== null && staleResult !== null;
  const activeTab = TABS.find((t) => t.id === tab)!;

  const handleSave = () => {
    if (intervalResult === null || staleResult === null) return;
    onSave({ intervalMinutes: intervalResult, staleMinutes: staleResult });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Tab nudges</DialogTitle>
          <DialogDescription>
            Get a gentle prompt to close, archive, or keep tabs you've left untouched.
          </DialogDescription>
        </DialogHeader>

        <button
          type="button"
          onClick={() => onEnabledChange(!enabled)}
          className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors ${
            enabled ? 'border-amber-400/60 bg-amber-400/15' : 'border-border bg-muted/40'
          }`}
        >
          <span className="flex items-center gap-2 text-sm font-medium">
            {enabled ? <Bell size={16} /> : <BellOff size={16} />}
            {enabled ? 'Nudges are on' : 'Nudges are off'}
          </span>
          <span
            className={`relative h-6 w-11 rounded-full transition-colors ${
              enabled ? 'bg-amber-400' : 'bg-muted'
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                enabled ? 'left-[22px]' : 'left-0.5'
              }`}
            />
          </span>
        </button>

        <div className="grid grid-cols-2 gap-1 rounded-full bg-muted p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === t.id
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <p className="text-sm text-muted-foreground">{activeTab.description}</p>

        {tab === 'frequency' ? (
          <DurationField draft={interval} onChange={setInterval} />
        ) : (
          <DurationField draft={stale} onChange={setStale} />
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
