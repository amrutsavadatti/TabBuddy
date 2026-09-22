import { useEffect, useState } from 'react';
import { deleteSnapshot, getSnapshots, updateSnapshot } from '@/lib/storage';
import { restoreSnapshot } from '@/lib/restore';
import { updateSnapshotFromLiveWindow } from '@/lib/update';
import type { Snapshot } from '@/lib/types';

function App() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

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

  const sortedSnapshots = [...snapshots].sort(
    (a, b) => b.usageCount - a.usageCount,
  );

  return (
    <>
      <h1>TabBuddy Dashboard</h1>
      {snapshots.length === 0 ? (
        <p>No snapshots saved yet.</p>
      ) : (
        <ul>
          {sortedSnapshots.map((snapshot) => (
            <li key={snapshot.id}>
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
                      <button onClick={() => removeTab(snapshot, index)}>
                        Remove
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default App;
