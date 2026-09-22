import { useEffect, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  Pin,
  PinOff,
  Trash2,
} from 'lucide-react';
import { deleteSnapshot, getSnapshots, updateSnapshot } from '@/lib/storage';
import { restoreSnapshot } from '@/lib/restore';
import { updateSnapshotFromLiveWindow } from '@/lib/update';
import { getDisplayOrder } from '@/lib/sort';
import type { Snapshot } from '@/lib/types';
import { getAccentColor } from '@/lib/color';
import { Button } from '@/components/ui/button';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function SnapshotCard({
  snapshot,
  dragHandle,
  renaming,
  renameValue,
  onRenameValueChange,
  onStartRename,
  onConfirmRename,
  onOpen,
  onUpdate,
  onDelete,
  onTogglePin,
  onRemoveTab,
  onMoveTab,
}: {
  snapshot: Snapshot;
  dragHandle?: React.ReactNode;
  renaming: boolean;
  renameValue: string;
  onRenameValueChange: (value: string) => void;
  onStartRename: () => void;
  onConfirmRename: () => void;
  onOpen: () => void;
  onUpdate: () => void;
  onDelete: () => void;
  onTogglePin: () => void;
  onRemoveTab: (index: number) => void;
  onMoveTab: (index: number, direction: -1 | 1) => void;
}) {
  const accent = getAccentColor(snapshot.name);

  return (
    <div
      className="flex flex-col gap-3 rounded-xl border-t-4 border-border bg-card p-4 text-card-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg"
      style={{ borderTopColor: accent }}
    >
      <div className="flex items-start justify-between gap-2">
        {renaming ? (
          <div className="flex flex-1 gap-2">
            <input
              className="w-full rounded-lg border border-border bg-background px-2 py-1 text-sm"
              value={renameValue}
              onChange={(e) => onRenameValueChange(e.target.value)}
              autoFocus
            />
            <Button size="sm" onClick={onConfirmRename}>
              Save
            </Button>
          </div>
        ) : (
          <button
            className="text-left text-lg font-semibold tracking-tight hover:underline"
            onClick={onStartRename}
            title="Rename"
          >
            {snapshot.name}
          </button>
        )}
        {dragHandle}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {snapshot.tabs.length} tabs
        </span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          opened {snapshot.usageCount}×
        </span>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-2">
          <Button size="sm" onClick={onOpen}>
            Open
          </Button>
          <Button size="sm" variant="outline" onClick={onUpdate}>
            Update
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            onClick={onTogglePin}
            title={snapshot.pinned ? 'Unpin' : 'Pin'}
            className={snapshot.pinned ? 'text-primary' : undefined}
          >
            {snapshot.pinned ? <PinOff size={16} /> : <Pin size={16} />}
          </Button>
          <Dialog>
            <DialogTrigger asChild>
              <Button size="icon" variant="ghost" title="Show tabs">
                <ChevronDown size={16} />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <div className="flex items-center gap-2">
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: accent }}
                  />
                  <DialogTitle>{snapshot.name}</DialogTitle>
                </div>
                <DialogDescription asChild>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      {snapshot.tabs.length} tabs
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      opened {snapshot.usageCount}×
                    </span>
                    {snapshot.tabGroups.length > 0 && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        {snapshot.tabGroups.length} groups
                      </span>
                    )}
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      created {formatDate(snapshot.createdAt)}
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      updated {formatDate(snapshot.updatedAt)}
                    </span>
                  </div>
                </DialogDescription>
              </DialogHeader>
              <ol className="flex flex-col gap-1 overflow-y-auto">
                {snapshot.tabs.map((tab, index) => (
                  <li
                    key={`${snapshot.id}-${index}`}
                    className="flex items-center gap-3 rounded-lg p-2 hover:bg-muted"
                  >
                    {tab.favIconUrl ? (
                      <img
                        src={tab.favIconUrl}
                        alt=""
                        className="h-6 w-6 shrink-0 rounded"
                      />
                    ) : (
                      <div className="h-6 w-6 shrink-0 rounded bg-muted" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {tab.title || tab.url}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {tab.url}
                      </p>
                    </div>
                    <span className="flex shrink-0 gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => onMoveTab(index, -1)}
                        disabled={index === 0}
                      >
                        <ChevronUp size={14} />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => onMoveTab(index, 1)}
                        disabled={index === snapshot.tabs.length - 1}
                      >
                        <ChevronDown size={14} />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => onRemoveTab(index)}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </span>
                  </li>
                ))}
              </ol>
            </DialogContent>
          </Dialog>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="icon" variant="ghost" className="text-destructive" title="Delete">
                <Trash2 size={16} />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete "{snapshot.name}"?</AlertDialogTitle>
                <AlertDialogDescription>
                  This can't be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

    </div>
  );
}

function SortablePinnedCard(props: React.ComponentProps<typeof SnapshotCard>) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: props.snapshot.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'opacity-40' : undefined}
    >
      <SnapshotCard
        {...props}
        dragHandle={
          <span
            {...attributes}
            {...listeners}
            className="cursor-grab select-none px-1 text-muted-foreground touch-none"
          >
            <GripVertical size={16} />
          </span>
        }
      />
    </div>
  );
}

function App() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  useEffect(() => {
    getSnapshots().then(setSnapshots);
  }, []);

  const patchSnapshot = (id: string, changes: Partial<Snapshot>) => {
    setSnapshots((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...changes } : s)),
    );
  };

  const handleOpen = async (snapshot: Snapshot) => {
    await restoreSnapshot(snapshot);
    getSnapshots().then(setSnapshots);
  };

  const handleUpdate = async (snapshot: Snapshot) => {
    const updated = await updateSnapshotFromLiveWindow(snapshot);
    if (!updated) {
      alert('Open this snapshot first, then update it.');
      return;
    }
    getSnapshots().then(setSnapshots);
  };

  const handleDelete = async (snapshot: Snapshot) => {
    await deleteSnapshot(snapshot.id);
    setSnapshots((prev) => prev.filter((s) => s.id !== snapshot.id));
  };

  const startRename = (snapshot: Snapshot) => {
    setRenamingId(snapshot.id);
    setRenameValue(snapshot.name);
  };

  const confirmRename = async (snapshot: Snapshot) => {
    const name = renameValue.trim() || snapshot.name;
    await updateSnapshot(snapshot.id, { name, updatedAt: Date.now() });
    patchSnapshot(snapshot.id, { name });
    setRenamingId(null);
  };

  const removeTab = async (snapshot: Snapshot, tabIndex: number) => {
    const tabs = snapshot.tabs.filter((_, i) => i !== tabIndex);
    await updateSnapshot(snapshot.id, { tabs, updatedAt: Date.now() });
    patchSnapshot(snapshot.id, { tabs });
  };

  const moveTab = async (snapshot: Snapshot, index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= snapshot.tabs.length) return;
    const tabs = [...snapshot.tabs];
    const temp = tabs[index]!;
    tabs[index] = tabs[targetIndex]!;
    tabs[targetIndex] = temp;
    await updateSnapshot(snapshot.id, { tabs, updatedAt: Date.now() });
    patchSnapshot(snapshot.id, { tabs });
  };

  const { pinned, unpinned } = getDisplayOrder(snapshots);

  const togglePin = async (snapshot: Snapshot) => {
    if (snapshot.pinned) {
      await updateSnapshot(snapshot.id, { pinned: false, pinnedPosition: null });
      patchSnapshot(snapshot.id, { pinned: false, pinnedPosition: null });
      return;
    }
    const pinnedPosition = pinned.length;
    await updateSnapshot(snapshot.id, { pinned: true, pinnedPosition });
    patchSnapshot(snapshot.id, { pinned: true, pinnedPosition });
  };

  const handlePinnedDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  };

  const handlePinnedDragEnd = (event: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = pinned.findIndex((s) => s.id === active.id);
    const newIndex = pinned.findIndex((s) => s.id === over.id);
    const reordered = arrayMove(pinned, oldIndex, newIndex);

    // Update local state synchronously so dnd-kit animates the drop into its
    // new slot instead of snapping back and then jumping on a later refresh.
    setSnapshots((prev) =>
      prev.map((s) => {
        const newPosition = reordered.findIndex((r) => r.id === s.id);
        return newPosition === -1 ? s : { ...s, pinnedPosition: newPosition };
      }),
    );

    reordered.forEach((snapshot, index) => {
      updateSnapshot(snapshot.id, { pinnedPosition: index }).catch(console.error);
    });
  };

  const cardProps = (snapshot: Snapshot) => ({
    snapshot,
    renaming: renamingId === snapshot.id,
    renameValue,
    onRenameValueChange: setRenameValue,
    onStartRename: () => startRename(snapshot),
    onConfirmRename: () => confirmRename(snapshot),
    onOpen: () => handleOpen(snapshot),
    onUpdate: () => handleUpdate(snapshot),
    onDelete: () => handleDelete(snapshot),
    onTogglePin: () => togglePin(snapshot),
    onRemoveTab: (index: number) => removeTab(snapshot, index),
    onMoveTab: (index: number, direction: -1 | 1) => moveTab(snapshot, index, direction),
  });

  return (
    <div className="mx-auto max-w-6xl p-6 md:p-8">
      <h1 className="mb-6 text-2xl font-semibold">TabBuddy Dashboard</h1>
      {snapshots.length === 0 ? (
        <p className="text-muted-foreground">No snapshots saved yet.</p>
      ) : (
        <div className="flex flex-col gap-8">
          {pinned.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <Pin size={14} /> Pinned
              </h2>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handlePinnedDragStart}
                onDragEnd={handlePinnedDragEnd}
              >
                <SortableContext
                  items={pinned.map((s) => s.id)}
                  strategy={rectSortingStrategy}
                >
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {pinned.map((snapshot) => (
                      <SortablePinnedCard key={snapshot.id} {...cardProps(snapshot)} />
                    ))}
                  </div>
                </SortableContext>
                <DragOverlay>
                  {activeDragId ? (
                    <div className="rotate-2 opacity-90 shadow-xl">
                      <SnapshotCard
                        {...cardProps(pinned.find((s) => s.id === activeDragId)!)}
                      />
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>
            </section>
          )}
          <section>
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">
              All snapshots
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {unpinned.map((snapshot) => (
                <SnapshotCard key={snapshot.id} {...cardProps(snapshot)} />
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default App;
