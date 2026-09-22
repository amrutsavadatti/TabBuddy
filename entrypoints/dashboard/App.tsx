import { useEffect, useState } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { deleteSnapshot, getSnapshots, updateSnapshot } from '@/lib/storage';
import { restoreSnapshot } from '@/lib/restore';
import { updateSnapshotFromLiveWindow } from '@/lib/update';
import { getDisplayOrder } from '@/lib/sort';
import type { Snapshot } from '@/lib/types';

function SortablePinnedItem({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <span {...attributes} {...listeners} style={{ cursor: 'grab' }}>
        ⠿
      </span>{' '}
      {children}
    </li>
  );
}

function App() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const sensors = useSensors(useSensor(PointerSensor));

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
    if (!confirm(`Delete "${snapshot.name}"? This can't be undone.`)) {
      return;
    }
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

  const handlePinnedDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = pinned.findIndex((s) => s.id === active.id);
    const newIndex = pinned.findIndex((s) => s.id === over.id);
    const reordered = arrayMove(pinned, oldIndex, newIndex);

    await Promise.all(
      reordered.map((snapshot, index) =>
        updateSnapshot(snapshot.id, { pinnedPosition: index }),
      ),
    );
    setSnapshots((prev) =>
      prev.map((s) => {
        const newPosition = reordered.findIndex((r) => r.id === s.id);
        return newPosition === -1 ? s : { ...s, pinnedPosition: newPosition };
      }),
    );
  };

  const renderSnapshotContent = (snapshot: Snapshot) => (
    <>
      {renamingId === snapshot.id ? (
        <>
          <input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            autoFocus
          />
          <button onClick={() => confirmRename(snapshot)}>Save name</button>
        </>
      ) : (
        <>
          {snapshot.name} — {snapshot.tabs.length} tabs — opened{' '}
          {snapshot.usageCount}×{' '}
          <button onClick={() => startRename(snapshot)}>Rename</button>
        </>
      )}{' '}
      <button onClick={() => handleOpen(snapshot)}>Open</button>{' '}
      <button onClick={() => handleUpdate(snapshot)}>Update</button>{' '}
      <button onClick={() => handleDelete(snapshot)}>Delete</button>{' '}
      <button onClick={() => togglePin(snapshot)}>
        {snapshot.pinned ? '📌 Unpin' : 'Pin'}
      </button>{' '}
      <button
        onClick={() =>
          setExpandedId(expandedId === snapshot.id ? null : snapshot.id)
        }
      >
        {expandedId === snapshot.id ? 'Hide tabs' : 'Show tabs'}
      </button>
      {expandedId === snapshot.id && (
        <ol>
          {snapshot.tabs.map((tab, index) => (
            <li key={`${snapshot.id}-${index}`}>
              {tab.title || tab.url}{' '}
              <button
                onClick={() => moveTab(snapshot, index, -1)}
                disabled={index === 0}
              >
                ↑
              </button>
              <button
                onClick={() => moveTab(snapshot, index, 1)}
                disabled={index === snapshot.tabs.length - 1}
              >
                ↓
              </button>
              <button onClick={() => removeTab(snapshot, index)}>Remove</button>
            </li>
          ))}
        </ol>
      )}
    </>
  );

  return (
    <>
      <h1>TabBuddy Dashboard</h1>
      {snapshots.length === 0 ? (
        <p>No snapshots saved yet.</p>
      ) : (
        <>
          {pinned.length > 0 && (
            <>
              <h2>📌 Pinned</h2>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handlePinnedDragEnd}
              >
                <SortableContext
                  items={pinned.map((s) => s.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <ul>
                    {pinned.map((snapshot) => (
                      <SortablePinnedItem key={snapshot.id} id={snapshot.id}>
                        {renderSnapshotContent(snapshot)}
                      </SortablePinnedItem>
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
            </>
          )}
          <h2>All snapshots</h2>
          <ul>
            {unpinned.map((snapshot) => (
              <li key={snapshot.id}>{renderSnapshotContent(snapshot)}</li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

export default App;
