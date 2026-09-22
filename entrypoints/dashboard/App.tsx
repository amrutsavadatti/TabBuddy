import { useEffect, useState } from 'react';
import { TriageView } from './TriageView';
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
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  EyeOff,
  GripVertical,
  HelpCircle,
  Keyboard,
  LayoutGrid,
  MousePointerClick,
  Palette,
  Pin,
  PinOff,
  RefreshCw,
  Save,
  Search,
  Shuffle,
  Square,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  addSnapshots,
  deleteSnapshot,
  deleteSnapshots,
  getSnapshots,
  updateSnapshot,
  updateSnapshots,
} from '@/lib/storage';
import { downloadSnapshotsAsFile, parseImportFile } from '@/lib/exportImport';
import { restoreSnapshot } from '@/lib/restore';
import { updateSnapshotFromLiveWindow } from '@/lib/update';
import { getDisplayOrder, SORT_OPTIONS, type SortOption } from '@/lib/sort';
import { VIBES, getStoredVibe, setStoredVibe, type Vibe } from '@/lib/vibes';
import { getHoverPeekEnabled, setHoverPeekEnabled } from '@/lib/peek';
import { getHasSeenOnboarding, setHasSeenOnboarding } from '@/lib/onboarding';
import type { Snapshot } from '@/lib/types';
import { getAccentColor } from '@/lib/color';
import { formatRelativeTime } from '@/lib/relativeTime';
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

const ONBOARDING_STEPS: {
  icon: typeof Save;
  title: string;
  description: string;
  accent: string;
  shortcut?: boolean;
}[] = [
  {
    icon: Save,
    title: 'Save a window',
    description:
      'Click the toolbar icon, then "Save this window" to snapshot every open tab (with a fun auto-generated name, or your own).',
    accent: VIBES[0]!.swatch,
  },
  {
    icon: MousePointerClick,
    title: 'Open with smart-detect',
    description:
      'Click "Open" on a snapshot to restore it. If its window is already open, TabBuddy focuses it instead of making a duplicate.',
    accent: VIBES[1]!.swatch,
  },
  {
    icon: RefreshCw,
    title: 'Update in place',
    description:
      'Snapshots are frozen until you say otherwise. Add or close tabs in a linked window, then click Update to re-save.',
    accent: VIBES[2]!.swatch,
  },
  {
    icon: LayoutGrid,
    title: 'Group by site',
    description:
      'One click in the popup groups a window\'s tabs by domain — every LinkedIn tab together, every YouTube tab together, and so on.',
    accent: VIBES[3]!.swatch,
  },
  {
    icon: Shuffle,
    title: 'Sort tabs one by one',
    description:
      'A Tinder-style triage screen: drag or click each tab left to close it, or right to file it into a new or existing snapshot. Undo anytime with Cmd/Ctrl+Z.',
    accent: VIBES[0]!.swatch,
  },
  {
    icon: Pin,
    title: 'Pin, search, and sort',
    description:
      'Pin your most-used windows to a fixed spot and drag to reorder them. Search by name, or sort the rest by usage or recency.',
    accent: VIBES[1]!.swatch,
  },
  {
    icon: CheckSquare,
    title: 'Select, export, import',
    description:
      'Use Select mode to bulk-export or delete snapshots. Export a single window to share it with a friend, or import one they send you.',
    accent: VIBES[2]!.swatch,
  },
  {
    icon: Eye,
    title: 'Hover to peek',
    description:
      'Hover any card to preview its tabs with favicons — everything else softly blurs to keep focus on what you\'re peeking at.',
    accent: VIBES[3]!.swatch,
  },
  {
    icon: Palette,
    title: 'Pick a vibe',
    description:
      'Click a colored swatch in the header to change the background gradient — Aurora, Sunset, Ocean, or Meadow.',
    accent: VIBES[0]!.swatch,
  },
  {
    icon: Keyboard,
    title: 'Keyboard shortcut',
    description: 'Open (or jump to) this dashboard from anywhere in the browser.',
    accent: VIBES[3]!.swatch,
    shortcut: true,
  },
];

function KeyCap({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-md border border-border bg-muted px-2.5 py-1.5 font-mono text-sm font-semibold shadow-sm">
      {children}
    </kbd>
  );
}

function ShortcutBadge({ label, keys }: { label: string; keys: string[] }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex gap-1">
        {keys.map((k, i) => (
          <KeyCap key={i}>{k}</KeyCap>
        ))}
      </div>
    </div>
  );
}

function OnboardingDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  const total = ONBOARDING_STEPS.length;
  const current = ONBOARDING_STEPS[step]!;
  const Icon = current.icon;
  const isLast = step === total - 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Welcome to TabBuddy 👋</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-2xl text-white shadow-md"
            style={{ backgroundImage: current.accent }}
          >
            <Icon size={28} />
          </div>
          <div>
            <p className="text-base font-semibold">{current.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{current.description}</p>
          </div>

          {current.shortcut && (
            <div className="flex gap-6 pt-1">
              <ShortcutBadge label="Windows / Linux" keys={['Ctrl', 'Shift', 'K']} />
              <ShortcutBadge label="Mac" keys={['⌘', 'Shift', 'K']} />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div className="flex gap-1.5">
            {ONBOARDING_STEPS.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 w-1.5 rounded-full ${i === step ? 'bg-primary' : 'bg-muted'}`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {step > 0 && (
              <Button size="sm" variant="outline" onClick={() => setStep((s) => s - 1)}>
                Back
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => (isLast ? onOpenChange(false) : setStep((s) => s + 1))}
            >
              {isLast ? 'Got it' : 'Next'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
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
  onExport,
  onRemoveTab,
  onMoveTab,
  selectionMode,
  selected,
  onToggleSelect,
  hoverPeek,
  isBlurred,
  onHoverStart,
  onHoverEnd,
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
  onExport: () => void;
  onRemoveTab: (index: number) => void;
  onMoveTab: (index: number, direction: -1 | 1) => void;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  hoverPeek?: boolean;
  isBlurred?: boolean;
  onHoverStart?: () => void;
  onHoverEnd?: () => void;
}) {
  const accent = getAccentColor(snapshot.name);

  return (
    <div
      className={`group relative transition-[filter,transform] duration-200 ${
        isBlurred ? 'z-0 scale-[0.99] blur-sm' : 'z-30'
      }`}
      onMouseEnter={hoverPeek ? onHoverStart : undefined}
      onMouseLeave={hoverPeek ? onHoverEnd : undefined}
    >
    <div
      className="flex flex-col gap-3 overflow-hidden rounded-xl border-t-4 border-border bg-card p-4 text-card-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg"
      style={{ borderTopColor: accent }}
    >
      <div className="flex items-start justify-between gap-2">
        {selectionMode && (
          <button onClick={onToggleSelect} className="text-primary" title="Select">
            {selected ? <CheckSquare size={18} /> : <Square size={18} />}
          </button>
        )}
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
        <span
          className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
          title={formatDate(snapshot.createdAt)}
        >
          created {formatRelativeTime(snapshot.createdAt)}
        </span>
        <span
          className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
          title={formatDate(snapshot.updatedAt)}
        >
          updated {formatRelativeTime(snapshot.updatedAt)}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <Button size="sm" onClick={onOpen}>
            Open
          </Button>
          <Button size="sm" variant="outline" onClick={onUpdate}>
            Update
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1">
          <Button
            size="icon"
            variant="ghost"
            onClick={onTogglePin}
            title={snapshot.pinned ? 'Unpin' : 'Pin'}
            className={snapshot.pinned ? 'text-primary' : undefined}
          >
            {snapshot.pinned ? <PinOff size={16} /> : <Pin size={16} />}
          </Button>
          <Button size="icon" variant="ghost" onClick={onExport} title="Export">
            <Download size={16} />
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
    {hoverPeek && (
      <div className="pointer-events-none absolute inset-x-0 top-full z-20 mt-2 hidden max-h-64 overflow-y-auto rounded-xl border border-border bg-card p-3 shadow-lg group-hover:block">
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          {snapshot.tabs.length} tabs
        </p>
        <ul className="flex flex-col gap-1.5">
          {snapshot.tabs.slice(0, 8).map((tab, index) => (
            <li key={index} className="flex items-center gap-2 text-xs">
              {tab.favIconUrl ? (
                <img src={tab.favIconUrl} alt="" className="h-4 w-4 shrink-0 rounded-sm" />
              ) : (
                <div className="h-4 w-4 shrink-0 rounded-sm bg-muted" />
              )}
              <span className="truncate">{tab.title || tab.url}</span>
            </li>
          ))}
          {snapshot.tabs.length > 8 && (
            <li className="text-xs text-muted-foreground">
              +{snapshot.tabs.length - 8} more
            </li>
          )}
        </ul>
      </div>
    )}
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
  const [vibe, setVibe] = useState<Vibe | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('mfu');
  const [hoverPeekEnabled, setHoverPeekEnabledState] = useState(true);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [triageWindowId, setTriageWindowId] = useState<number | null>(() => {
    const raw = new URLSearchParams(window.location.search).get('triage');
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) ? parsed : null;
  });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  useEffect(() => {
    getSnapshots().then(setSnapshots);
    getStoredVibe().then((v) => {
      setVibe(v);
      document.documentElement.dataset.vibe = v;
    });
    getHoverPeekEnabled().then(setHoverPeekEnabledState);
    getHasSeenOnboarding().then((seen) => {
      if (!seen) {
        setOnboardingOpen(true);
        setHasSeenOnboarding(true);
      }
    });
  }, []);

  const handleVibeChange = (v: Vibe) => {
    setVibe(v);
    document.documentElement.dataset.vibe = v;
    setStoredVibe(v);
  };

  const toggleHoverPeek = () => {
    setHoverPeekEnabledState((prev) => {
      const next = !prev;
      setHoverPeekEnabled(next);
      return next;
    });
  };

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

  const filteredSnapshots = snapshots.filter((s) =>
    s.name.toLowerCase().includes(searchQuery.trim().toLowerCase()),
  );
  const { pinned, unpinned } = getDisplayOrder(filteredSnapshots, sortBy);

  const togglePin = async (snapshot: Snapshot) => {
    if (snapshot.pinned) {
      await updateSnapshot(snapshot.id, { pinned: false, pinnedPosition: null });
      patchSnapshot(snapshot.id, { pinned: false, pinnedPosition: null });
      return;
    }
    const pinnedPosition = snapshots.filter((s) => s.pinned).length;
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

    updateSnapshots(
      reordered.map((snapshot, index) => ({
        id: snapshot.id,
        changes: { pinnedPosition: index },
      })),
    ).catch(console.error);
  };

  const toggleSelectionMode = () => {
    setSelectionMode((prev) => !prev);
    setSelectedIds(new Set());
    setHoveredId(null);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAllOrNone = () => {
    setSelectedIds((prev) =>
      prev.size === snapshots.length ? new Set() : new Set(snapshots.map((s) => s.id)),
    );
  };

  const exportSelected = () => {
    const toExport = snapshots.filter((s) => selectedIds.has(s.id));
    if (toExport.length === 0) return;
    downloadSnapshotsAsFile(toExport);
    toggleSelectionMode();
  };

  const deleteSelected = async () => {
    await deleteSnapshots([...selectedIds]);
    setSnapshots((prev) => prev.filter((s) => !selectedIds.has(s.id)));
    toggleSelectionMode();
  };

  const handleImportFile = async (file: File) => {
    try {
      const imported = await parseImportFile(file, snapshots.map((s) => s.name));
      await addSnapshots(imported);
      getSnapshots().then(setSnapshots);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to import file.');
    }
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
    onExport: () => downloadSnapshotsAsFile([snapshot]),
    onRemoveTab: (index: number) => removeTab(snapshot, index),
    onMoveTab: (index: number, direction: -1 | 1) => moveTab(snapshot, index, direction),
    selectionMode,
    selected: selectedIds.has(snapshot.id),
    onToggleSelect: () => toggleSelect(snapshot.id),
    hoverPeek: hoverPeekEnabled && !selectionMode,
    isBlurred: !selectionMode && hoveredId !== null && hoveredId !== snapshot.id,
    onHoverStart: () => setHoveredId(snapshot.id),
    onHoverEnd: () => setHoveredId(null),
  });

  const chromeBlurClass = `transition-[filter] duration-200 ${hoveredId ? 'blur-sm' : ''}`;

  if (triageWindowId !== null) {
    return (
      <TriageView
        windowId={triageWindowId}
        onExit={() => {
          setTriageWindowId(null);
          window.history.replaceState({}, '', '/dashboard.html');
          getSnapshots().then(setSnapshots);
        }}
      />
    );
  }

  return (
    <div className="mx-auto max-w-6xl p-6 md:p-8">
      <div className={`mb-6 flex flex-wrap items-center justify-between gap-3 ${chromeBlurClass}`}>
        <h1 className="text-2xl font-semibold">TabBuddy Dashboard</h1>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            {VIBES.map((v) => (
              <button
                key={v.id}
                title={v.label}
                onClick={() => handleVibeChange(v.id)}
                className={`h-6 w-6 rounded-full border-2 transition-transform hover:scale-110 ${
                  vibe === v.id ? 'border-foreground' : 'border-transparent'
                }`}
                style={{ backgroundImage: v.swatch }}
              />
            ))}
          </div>

          <Button
            size="sm"
            variant={hoverPeekEnabled ? 'default' : 'outline'}
            onClick={toggleHoverPeek}
            title="Hover over a card to peek its tabs"
          >
            {hoverPeekEnabled ? <Eye size={14} className="mr-1" /> : <EyeOff size={14} className="mr-1" />}
            Hover peek
          </Button>

          <Button
            size="icon"
            variant="ghost"
            onClick={() => setOnboardingOpen(true)}
            title="Help / tutorial"
          >
            <HelpCircle size={16} />
          </Button>

          {selectionMode ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {selectedIds.size} selected
              </span>
              <Button size="sm" variant="outline" onClick={selectAllOrNone}>
                {selectedIds.size === snapshots.length ? 'Deselect all' : 'Select all'}
              </Button>
              <Button size="sm" onClick={exportSelected} disabled={selectedIds.size === 0}>
                <Download size={14} className="mr-1" /> Export selected
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="destructive" disabled={selectedIds.size === 0}>
                    <Trash2 size={14} className="mr-1" /> Delete selected
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Delete {selectedIds.size} snapshot{selectedIds.size === 1 ? '' : 's'}?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      This can't be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={deleteSelected}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button size="sm" variant="outline" onClick={toggleSelectionMode}>
                <X size={14} className="mr-1" /> Cancel
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={toggleSelectionMode}>
                <CheckSquare size={14} className="mr-1" /> Select
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => downloadSnapshotsAsFile(snapshots)}
                disabled={snapshots.length === 0}
              >
                <Download size={14} className="mr-1" /> Export all
              </Button>
              <label>
                <Button size="sm" variant="outline" asChild>
                  <span>
                    <Upload size={14} className="mr-1" /> Import
                  </span>
                </Button>
                <input
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleImportFile(file);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
          )}
        </div>
      </div>

      {snapshots.length > 0 && (
        <div className={`mb-6 flex flex-wrap items-center gap-3 ${chromeBlurClass}`}>
          <div className="relative min-w-[220px] flex-1">
            <Search
              size={15}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search snapshots..."
              className="w-full rounded-full border border-border bg-card py-2 pl-9 pr-4 text-sm shadow-sm outline-none transition-shadow focus:shadow-md focus:ring-2 focus:ring-primary/40"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                title="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <div className="relative">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="appearance-none rounded-full border border-border bg-card py-2 pl-4 pr-9 text-sm shadow-sm outline-none transition-shadow focus:shadow-md focus:ring-2 focus:ring-primary/40"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
            <ChevronDown
              size={14}
              className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
          </div>
        </div>
      )}

      {snapshots.length === 0 ? (
        <p className="text-muted-foreground">No snapshots saved yet.</p>
      ) : filteredSnapshots.length === 0 ? (
        <p className="text-muted-foreground">
          No snapshots match "{searchQuery}".
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          {pinned.length > 0 && (
            <section>
              <h2 className={`mb-3 flex items-center gap-1.5 text-sm font-medium text-muted-foreground ${chromeBlurClass}`}>
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
            <h2 className={`mb-3 text-sm font-medium text-muted-foreground ${chromeBlurClass}`}>
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
      <OnboardingDialog open={onboardingOpen} onOpenChange={setOnboardingOpen} />
    </div>
  );
}

export default App;
