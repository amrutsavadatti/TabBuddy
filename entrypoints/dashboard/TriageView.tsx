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
  Keyboard,
  MousePointerClick,
  Plus,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import {
  addSnapshot,
  deleteSnapshot,
  getSnapshots,
  updateSnapshot,
} from '@/lib/storage';
import { generateSnapshotName, getUniqueName } from '@/lib/names';
import { tabToSnapshotTab, type TriageTab } from '@/lib/triage';
import { getAccentColor } from '@/lib/color';
import { resolveLazyTab } from '@/lib/lazyTab';
import { ARCHIVED_ACCENT_COLOR, isArchivedSnapshot } from '@/lib/archive';
import { Button } from '@/components/ui/button';
import type { Snapshot } from '@/lib/types';

type HistoryEntry =
  | { type: 'delete' }
  | { type: 'file'; snapshotId: string; wasNewlyCreatedSnapshot: boolean };

async function appendTabToSnapshot(id: string, tab: ReturnType<typeof tabToSnapshotTab>) {
  const all = await getSnapshots();
  const target = all.find((s) => s.id === id);
  if (!target) throw new Error('That snapshot no longer exists.');
  await updateSnapshot(id, { tabs: [...target.tabs, tab], updatedAt: Date.now() });
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

function DeleteDropZone({ onClick }: { onClick: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'delete' });
  return (
    <button
      ref={setNodeRef}
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
  onExit,
}: {
  windowId: number;
  onExit: () => void;
}) {
  const [tabs, setTabs] = useState<TriageTab[] | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [existingSnapshots, setExistingSnapshots] = useState<Snapshot[]>([]);
  const [sessionSnapshotId, setSessionSnapshotId] = useState<string | null>(null);
  const [sessionSnapshotName, setSessionSnapshotName] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  useEffect(() => {
    (async () => {
      const rawTabs = await browser.tabs.query({ windowId });
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
  }, [windowId]);

  const currentTab = tabs?.[currentIndex] ?? null;

  const finishIfDone = async (nextIndex: number) => {
    if (!tabs) return;
    if (nextIndex >= tabs.length) {
      await browser.windows.remove(windowId);
      onExit();
      return;
    }
    setCurrentIndex(nextIndex);
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

  const handleDropToNew = async () => {
    if (!currentTab) return;
    setError(null);
    try {
      const snapshotTab = tabToSnapshotTab(currentTab);
      let wasNewlyCreated = false;
      let targetId = sessionSnapshotId;

      if (!targetId) {
        const allSnapshots = await getSnapshots();
        const name = getUniqueName(
          generateSnapshotName(),
          allSnapshots.map((s) => s.name),
        );
        const snapshot: Snapshot = {
          id: crypto.randomUUID(),
          name,
          tabs: [snapshotTab],
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
        targetId = snapshot.id;
        wasNewlyCreated = true;
        setSessionSnapshotId(snapshot.id);
        setSessionSnapshotName(snapshot.name);
      } else {
        await appendTabToSnapshot(targetId, snapshotTab);
      }

      setHistory((h) => [
        ...h,
        { type: 'file', snapshotId: targetId!, wasNewlyCreatedSnapshot: wasNewlyCreated },
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
      setHistory((h) => [...h, { type: 'file', snapshotId, wasNewlyCreatedSnapshot: false }]);
      await finishIfDone(currentIndex + 1);
    } catch {
      setError("Couldn't save that tab to a snapshot. Nothing was changed — try again.");
    }
  };

  const handleUndo = async () => {
    const last = history[history.length - 1];
    if (!last) return;
    setError(null);
    try {
      if (last.type === 'delete') {
        await browser.sessions.restore();
        // Restoring a tab focuses it — steal focus back to this triage tab.
        const selfTab = await browser.tabs.getCurrent();
        if (selfTab?.id !== undefined) {
          await browser.tabs.update(selfTab.id, { active: true });
          if (selfTab.windowId !== undefined) {
            await browser.windows.update(selfTab.windowId, { focused: true });
          }
        }
      } else {
        const remainingCount = await removeLastTabFromSnapshot(last.snapshotId);
        if (last.wasNewlyCreatedSnapshot && remainingCount === 0) {
          await deleteSnapshot(last.snapshotId);
          setSessionSnapshotId(null);
          setSessionSnapshotName(null);
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
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo]);

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
        <div className="h-1 w-full bg-muted">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${(currentIndex / tabs.length) * 100}%` }}
          />
        </div>

        <div className="flex flex-1 overflow-hidden">
          <div className="relative z-20 flex w-[10%] min-w-[80px] items-center justify-center border-r border-border bg-muted/30">
            <DeleteDropZone onClick={handleDelete} />
          </div>

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
              <Button size="icon" variant="ghost" onClick={onExit} title="Exit sorting">
                <X size={14} />
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
          </div>

          <div className="relative z-20 flex w-[22%] min-w-[220px] flex-col gap-3 overflow-y-auto border-l border-border bg-muted/30 p-4">
            <DropTile id="new-snapshot" onClick={handleDropToNew}>
              <Plus size={16} className="mx-auto mb-1" />
              {sessionSnapshotName ? `Add to "${sessionSnapshotName}"` : 'New snapshot'}
            </DropTile>
            {existingSnapshots.map((s) => (
              <DropTile
                key={s.id}
                id={s.id}
                style={{
                  borderTopColor: isArchivedSnapshot(s) ? ARCHIVED_ACCENT_COLOR : getAccentColor(s.name),
                }}
                onClick={() => handleDropToExisting(s.id)}
              >
                {s.name}
              </DropTile>
            ))}
          </div>
        </div>
      </div>
    </DndContext>
  );
}
