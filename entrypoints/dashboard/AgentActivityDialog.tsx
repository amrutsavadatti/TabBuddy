import { Undo2 } from 'lucide-react';
import type { ActivityEntry } from '../../bridge/protocol';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { groupActivity } from '@/lib/agentActivityView';
import { formatRelativeTime } from '@/lib/relativeTime';

const NO_REQUEST = 'No request noted';

/** What an AI agent has done through TabBuddy, sorted by what you asked it for
 * (newest first), with an Undo for each archive, close or removal that can
 * still be reversed. */
export function AgentActivityDialog({
  open,
  onOpenChange,
  entries,
  busyId,
  error,
  onUndo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The log, newest first. */
  entries: ActivityEntry[];
  /** The entry being undone right now, so its button can't be pressed twice. */
  busyId: string | null;
  /** Why the last undo failed, shown here because a toast reads as success. */
  error: string | null;
  onUndo: (id: string) => void;
}) {
  const groups = groupActivity(entries);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Agent activity</DialogTitle>
          <DialogDescription>
            What an AI agent has done through TabBuddy, sorted by what you asked it for. Archiving,
            closing and removing saved tabs can be undone, for the 20 most recent.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Couldn't undo: {error}
          </p>
        )}

        {groups.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            Nothing yet. When an AI agent uses TabBuddy to open, save or tidy tabs, it shows up here.
          </p>
        ) : (
          <ul className="flex max-h-96 flex-col gap-3 overflow-y-auto" aria-label="Agent activity">
            {groups.map((group) => (
              <li key={group.id} className="overflow-hidden rounded-xl border border-border">
                <div className="flex items-baseline justify-between gap-3 border-b border-border bg-muted/40 px-3 py-2">
                  <p
                    className={`min-w-0 text-sm font-semibold ${group.request === null ? 'text-muted-foreground' : ''}`}
                    title={
                      group.request === null
                        ? "The agent didn't say what you asked for, so these are grouped by when they happened"
                        : undefined
                    }
                  >
                    {group.request ?? NO_REQUEST}
                  </p>
                  <p className="shrink-0 text-xs text-muted-foreground">
                    {group.entries.length} {group.entries.length === 1 ? 'action' : 'actions'} ·{' '}
                    {formatRelativeTime(group.newestAt)}
                  </p>
                </div>
                <ul className="flex flex-col divide-y divide-border">
                  {group.entries.map((entry) => (
                    <li key={entry.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <div className="min-w-0">
                        <p
                          className={`text-sm font-medium ${entry.undone ? 'text-muted-foreground line-through' : ''}`}
                        >
                          {entry.summary}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatRelativeTime(entry.at)}
                          {entry.undone ? ' · undone' : ''}
                        </p>
                      </div>
                      {entry.undoable && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId !== null}
                          onClick={() => onUndo(entry.id)}
                          title="Reverse this action"
                        >
                          <Undo2 size={14} />
                          {busyId === entry.id ? 'Undoing…' : 'Undo'}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
