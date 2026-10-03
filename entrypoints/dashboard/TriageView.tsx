import { useEffect, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useDndContext,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  AlertTriangle,
  CheckCircle2,
  Keyboard,
  MousePointerClick,
  Pencil,
  Plus,
  SkipForward,
  Sparkles,
  Trash2,
  Undo2,
} from 'lucide-react';
import {
  addSnapshot,
  deleteSnapshot,
  getSnapshots,
  updateSnapshot,
} from '@/lib/storage';
import { generateSnapshotName, getUniqueName } from '@/lib/names';
import { tabToSnapshotTab, type TriageTab } from '@/lib/triage';
import { countSkipped, isTypingTarget, shouldCloseWindowAtEnd } from '@/lib/triageSkip';
import { getAccentColor } from '@/lib/color';
import { resolveLazyTab } from '@/lib/lazyTab';
import { ARCHIVED_ACCENT_COLOR, isArchivedSnapshot, renameSnapshot } from '@/lib/archive';
import { Button } from '@/components/ui/button';
import { closesWindowWhenDone } from '@/lib/manualTriage';
import type { Snapshot } from '@/lib/types';

type HistoryEntry =
  | { type: 'delete' }
  | { type: 'skip' }
  | { type: 'file'; snapshotId: string; wasNewlyCreatedSnapshot: boolean };

async function appendTabToSnapshot(id: string, tab: ReturnType<typeof tabToSnapshotTab>) {
  const all = await getSnapshots();
  const target = all.find((s) => s.id === id);
  if (!target) throw new Error('That snapshot no longer exists.');
  await updateSnapshot(id, { tabs: [...target.tabs, tab], updatedAt: Date.now() });
}

/** Files a tab away for real: append it to the snapshot, then close the
 * live tab so it actually leaves the window being sorted. */
async function closeTab(tabId: number): Promise<void> {
  try {
    await browser.tabs.remove(tabId);
  } catch {
    // already closed — fine either way
  }
}

/** Restoring a closed tab focuses it — steal focus back to this triage tab. */
async function refocusSelf(): Promise<void> {
  const selfTab = await browser.tabs.getCurrent();
  if (selfTab?.id !== undefined) {
    await browser.tabs.update(selfTab.id, { active: true });
    if (selfTab.windowId !== undefined) {
      await browser.windows.update(selfTab.windowId, { focused: true });
    }
  }
}

async function removeLastTabFromSnapshot(id: string): Promise<number> {
  const all = await getSnapshots();
  const target = all.find((s) => s.id === id);
  if (!target) return 0;
  const tabs = target.tabs.slice(0, -1);
  await updateSnapshot(id, { tabs, updatedAt: Date.now() });
  return tabs.length;
}

function DropTile({
  id,
  style,
  onClick,
  children,
}: {
  id: string;
  style?: React.CSSProperties;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <button
      ref={setNodeRef}
      onClick={onClick}
      style={style}
      className={`w-full rounded-xl border-t-4 border-border bg-card p-3 text-center text-sm font-medium shadow-sm transition-all duration-150 hover:py-6 hover:shadow-md ${
        isOver ? 'z-10 scale-110 border-primary shadow-xl ring-2 ring-primary' : 'scale-100'
      }`}
    >
      {children}
    </button>
  );
}

/** The whole left strip is the drop target, so a card dropped anywhere in it
 * is closed; the trash icon just reacts (and still works as a plain button). */
function DeleteStrip({ onClick }: { onClick: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'delete' });
  return (
    <div
      ref={setNodeRef}
      className={`relative z-20 flex w-[10%] min-w-[80px] items-center justify-center border-r transition-colors duration-150 ${
        isOver ? 'border-destructive bg-destructive/15' : 'border-border bg-muted/30'
      }`}
    >
      <button
        onClick={onClick}
        title="Close this tab"
        className={`flex h-16 w-16 items-center justify-center rounded-full text-destructive shadow-sm transition-all duration-150 ${
          isOver
            ? 'scale-125 bg-destructive text-destructive-foreground shadow-xl ring-2 ring-destructive'
            : 'scale-100 bg-destructive/10 hover:bg-destructive/20'
        }`}
      >
        <Trash2 size={24} />
      </button>
    </div>
  );
}

function DraggableCard({ tab }: { tab: TriageTab }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: 'triage-card',
  });
  const { over } = useDndContext();
  const isOverTarget = over?.id !== undefined;

  const style: React.CSSProperties = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0) rotate(${transform.x / 18}deg) scale(${isOverTarget ? 0.8 : 1})`,
      }
    : {};

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={style}
      className={`relative flex w-full max-w-md cursor-grab touch-none select-none flex-col items-center gap-4 rounded-2xl border border-border bg-card p-10 text-center shadow-lg transition-[opacity,box-shadow] active:cursor-grabbing ${
        isDragging ? 'shadow-2xl' : 'hover:shadow-xl'
      } ${isOverTarget ? 'opacity-40' : ''}`}
    >
      {tab.favIconUrl ? (
        <img src={tab.favIconUrl} alt="" className="h-12 w-12 rounded-lg" />
      ) : (
        <div className="h-12 w-12 rounded-lg bg-muted" />
      )}
      <p className="line-clamp-2 text-lg font-semibold">{tab.title || tab.url}</p>
      <p className="max-w-full truncate text-sm text-muted-foreground">{tab.url}</p>
    </div>
  );
}

export function TriageView({
  windowId,
  onlyTabIds = null,
  onExit,
}: {
  windowId: number;
  /** Just these tabs, handed over by an agent that was unsure about them. Null sorts the whole window. */
  onlyTabIds?: number[] | null;
  onExit: () => void;
}) {
  const [tabs, setTabs] = useState<TriageTab[] | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [existingSnapshots, setExistingSnapshots] = useState<Snapshot[]>([]);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // Snapshots created and renamed during this triage session: an undo that
  // empties one of these keeps it (the user clearly wanted it), rather than
  // deleting it the way an untouched auto-named one is.
  const [renamedIds, setRenamedIds] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  useEffect(() => {
    (async () => {
      // A handed-over list is shown in the order given, skipping any tab that has since gone.
      const rawTabs = onlyTabIds
        ? (await Promise.all(onlyTabIds.map((id) => browser.tabs.get(id).catch(() => undefined)))).filter(
            (t): t is NonNullable<typeof t> => t !== undefined && !t.incognito,
          )
        : await browser.tabs.query({ windowId });
      setTabs(
        rawTabs
          .filter((t) => t.id !== undefined)
          .map(resolveLazyTab)
          .map((t) => ({
            id: t.id!,
            url: t.url ?? '',
            title: t.title ?? '',
            favIconUrl: t.favIconUrl,
            pinned: t.pinned ?? false,
          })),
      );
      const snapshots = await getSnapshots();
      setExistingSnapshots([...snapshots].sort((a, b) => b.updatedAt - a.updatedAt));
    })();
  }, [windowId, onlyTabIds?.join(',')]);

  const currentTab = tabs?.[currentIndex] ?? null;

  /** Moves on to the next tab, or ends the session after the last one. The
   * window is only closed if every tab in it was closed or filed: a skipped tab
   * is still open in it and must stay. */
  const finishIfDone = async (nextIndex: number, skippedCount = countSkipped(history)) => {
    if (!tabs) return;
    if (nextIndex >= tabs.length) {
      // Only a whole-window session closes the window, and only if nothing was skipped: the user
      // has been through every tab in it and none is left open. A few handed-over tabs must leave
      // the window alone, or tabs the user never saw would close.
      if (closesWindowWhenDone(onlyTabIds) && shouldCloseWindowAtEnd(skippedCount)) {
        await browser.windows.remove(windowId);
      }
      onExit();
      return;
    }
    setCurrentIndex(nextIndex);
  };

  /** Leaves the tab exactly as it is (still open, in no snapshot) and moves on. */
  const handleSkip = async () => {
    if (!currentTab) return;
    setError(null);
    setHistory((h) => [...h, { type: 'skip' }]);
    await finishIfDone(currentIndex + 1, countSkipped(history) + 1);
  };

  const handleDelete = async () => {
    if (!currentTab) return;
    setError(null);
    try {
      await browser.tabs.remove(currentTab.id);
      setHistory((h) => [...h, { type: 'delete' }]);
      await finishIfDone(currentIndex + 1);
    } catch {
      setError("Couldn't close that tab. It may already be closed.");
    }
  };

  /** "New snapshot" always creates a fresh one. It is immediately shown in
   * the list like any other snapshot and opened for renaming, so a second
   * tab meant for it is dropped on its own tile, not on "New snapshot"
   * again — which stays available to start yet another one. */
  const handleDropToNew = async () => {
    if (!currentTab) return;
    setError(null);
    try {
      const allSnapshots = await getSnapshots();
      const name = getUniqueName(
        generateSnapshotName(),
        allSnapshots.map((s) => s.name),
      );
      const snapshot: Snapshot = {
        id: crypto.randomUUID(),
        name,
        tabs: [tabToSnapshotTab(currentTab)],
        tabGroups: [],
        linkedWindowId: null,
        categoryIds: [],
        usageCount: 0,
        pinned: false,
        pinnedPosition: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await addSnapshot(snapshot);
      setExistingSnapshots((prev) => [snapshot, ...prev]);
      setRenameValue(snapshot.name);
      setRenamingId(snapshot.id);
      await closeTab(currentTab.id);

      setHistory((h) => [
        ...h,
        { type: 'file', snapshotId: snapshot.id, wasNewlyCreatedSnapshot: true },
      ]);
      await finishIfDone(currentIndex + 1);
    } catch {
      setError("Couldn't save that tab to a snapshot. Nothing was changed — try again.");
    }
  };

  const handleDropToExisting = async (snapshotId: string) => {
    if (!currentTab) return;
    setError(null);
    try {
      await appendTabToSnapshot(snapshotId, tabToSnapshotTab(currentTab));
      await closeTab(currentTab.id);
      setHistory((h) => [...h, { type: 'file', snapshotId, wasNewlyCreatedSnapshot: false }]);
      await finishIfDone(currentIndex + 1);
    } catch {
      setError("Couldn't save that tab to a snapshot. Nothing was changed — try again.");
    }
  };

  const startRenaming = (snapshot: Snapshot) => {
    setRenameValue(snapshot.name);
    setRenamingId(snapshot.id);
  };

  const confirmRename = async () => {
    if (!renamingId) return;
    setError(null);
    try {
      const name = await renameSnapshot(renamingId, renameValue);
      setExistingSnapshots((prev) => prev.map((s) => (s.id === renamingId ? { ...s, name } : s)));
      setRenamedIds((prev) => new Set(prev).add(renamingId));
      setRenamingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't rename that snapshot.");
    }
  };

  /** Brings back the tab that was just closed. The browser gives a restored tab a NEW
   * id, so the card it came from is pointed at that id: otherwise closing it a second
   * time would try the old id and fail with "may already be closed". The restored
   * session is a tab, or a whole window if it was the last tab in one. */
  const restoreLastClosedTab = async () => {
    const restored = await browser.sessions.restore();
    const restoredId = restored?.tab?.id ?? restored?.window?.tabs?.[0]?.id;
    if (restoredId !== undefined) {
      // The step being undone was taken on the card just before the current one.
      const undoneIndex = Math.max(0, currentIndex - 1);
      setTabs((prev) => prev && prev.map((t, i) => (i === undoneIndex ? { ...t, id: restoredId } : t)));
    }
    await refocusSelf();
  };

  const handleUndo = async () => {
    const last = history[history.length - 1];
    if (!last) return;
    setError(null);
    try {
      if (last.type === 'skip') {
        // nothing was changed, so there is nothing to bring back
      } else if (last.type === 'delete') {
        await restoreLastClosedTab();
      } else {
        // The tab was closed after being filed away — bring it back too.
        await restoreLastClosedTab();
        const remainingCount = await removeLastTabFromSnapshot(last.snapshotId);
        const keepEmpty = renamedIds.has(last.snapshotId);
        if (last.wasNewlyCreatedSnapshot && remainingCount === 0 && !keepEmpty) {
          await deleteSnapshot(last.snapshotId);
          setExistingSnapshots((prev) => prev.filter((s) => s.id !== last.snapshotId));
        }
      }
      setHistory((h) => h.slice(0, -1));
      setCurrentIndex((i) => Math.max(0, i - 1));
    } catch {
      setError("Couldn't undo that step.");
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isUndoCombo = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z';
      if (isUndoCombo) {
        e.preventDefault();
        handleUndo();
        return;
      }
      const isSkipKey = !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 's';
      if (isSkipKey && !isTypingTarget(e.target)) {
        e.preventDefault();
        handleSkip();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleSkip]);

  const handleDragEnd = (event: DragEndEvent) => {
    const overId = event.over?.id;
    if (!overId) return;
    if (overId === 'delete') {
      handleDelete();
    } else if (overId === 'new-snapshot') {
      handleDropToNew();
    } else {
      handleDropToExisting(String(overId));
    }
  };

  if (!tabs) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (tabs.length === 0) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 text-muted-foreground">
        <p>No tabs to sort.</p>
        <Button size="sm" variant="outline" onClick={onExit}>
          Exit
        </Button>
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={handleDragEnd}>
      <div className="flex h-screen w-full flex-col overflow-hidden">
        <div className="flex items-center justify-center gap-2 border-b border-border bg-muted/30 px-4 py-2 text-center text-xs text-muted-foreground">
          <Sparkles size={14} className="shrink-0 text-primary" />
          <span>
            {onlyTabIds === null
              ? "Go through a messy window one tab at a time: close what you don't need, file the rest into a snapshot, or skip a tab to leave it as it is."
              : `Your assistant wasn't sure about ${tabs.length === 1 ? 'this tab' : `these ${tabs.length} tabs`}. Decide ${tabs.length === 1 ? 'it' : 'each one'}: close it, file it into a snapshot, or skip it. Every other tab in the window stays exactly as it is.`}
          </span>
        </div>

        <div className="h-1 w-full bg-muted">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${(currentIndex / tabs.length) * 100}%` }}
          />
        </div>

        <div className="flex flex-1 overflow-hidden">
          <DeleteStrip onClick={handleDelete} />


          <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>
                Tab {currentIndex + 1} of {tabs.length}
              </span>
              <Button
                size="icon"
                variant="ghost"
                onClick={handleUndo}
                disabled={history.length === 0}
                title="Undo last step"
              >
                <Undo2 size={14} />
              </Button>
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertTriangle size={14} />
                {error}
              </div>
            )}

            {currentTab && <DraggableCard tab={currentTab} />}

            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <MousePointerClick size={16} />
                Drag or click a target to file the tab
              </span>
              <span className="flex items-center gap-1.5">
                <SkipForward size={16} />
                Skip leaves it open (press{' '}
                <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
                  S
                </kbd>
                )
              </span>
              <span className="flex items-center gap-1.5">
                <Keyboard size={16} />
                Undo with{' '}
                <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
                  ⌘/Ctrl
                </kbd>
                +
                <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
                  Z
                </kbd>
              </span>
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                onClick={handleSkip}
                title="Leave this tab open, untouched, and move on to the next one"
              >
                <SkipForward size={16} className="mr-1.5" /> Skip
              </Button>
              <Button
                variant="outline"
                className="border-emerald-400 bg-emerald-400 text-emerald-950 hover:bg-emerald-300"
                onClick={onExit}
                title="Stop sorting now — every tab you haven't gotten to yet stays open, untouched"
              >
                <CheckCircle2 size={16} className="mr-1.5" /> Finish
              </Button>
            </div>
          </div>

          <div className="relative z-20 flex w-[22%] min-w-[220px] flex-col gap-3 overflow-y-auto border-l border-border bg-muted/30 p-4">
            <h2 className="text-center text-sm font-medium text-muted-foreground">
              Your snapshots
            </h2>

            <DropTile id="new-snapshot" onClick={handleDropToNew}>
              <Plus size={16} className="mx-auto mb-1" />
              New snapshot
            </DropTile>

            {existingSnapshots.map((s) =>
              renamingId === s.id ? (
                <div
                  key={s.id}
                  className="flex gap-2 rounded-xl border-t-4 border-primary bg-card p-3 shadow-sm"
                >
                  <input
                    autoFocus
                    className="w-full rounded-lg border border-border bg-background px-2 py-1 text-sm"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && confirmRename()}
                  />
                  <Button size="sm" onClick={confirmRename}>
                    Save
                  </Button>
                </div>
              ) : (
                <div key={s.id} className="group relative">
                  <DropTile
                    id={s.id}
                    style={{
                      borderTopColor: isArchivedSnapshot(s)
                        ? ARCHIVED_ACCENT_COLOR
                        : getAccentColor(s.name),
                    }}
                    onClick={() => handleDropToExisting(s.id)}
                  >
                    {s.name}
                  </DropTile>
                  {!isArchivedSnapshot(s) && (
                    <button
                      onClick={() => startRenaming(s)}
                      title="Rename this snapshot"
                      className="absolute right-2 top-2 rounded-full p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
                    >
                      <Pencil size={13} />
                    </button>
                  )}
                </div>
              ),
            )}
          </div>
        </div>

      </div>
    </DndContext>
  );
}
