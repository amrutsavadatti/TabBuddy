import { useEffect, useState } from 'react';
import { deleteSnapshot, getSnapshots } from '@/lib/storage';
import { restoreSnapshot } from '@/lib/restore';
import { updateSnapshotFromLiveWindow } from '@/lib/update';
import type { Snapshot } from '@/lib/types';

function App() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);

  useEffect(() => {
    getSnapshots().then(setSnapshots);
  }, []);

  const handleOpen = async (snapshot: Snapshot) => {
    const windowId = await restoreSnapshot(snapshot);
    setSnapshots((prev) =>
      prev.map((s) => (s.id === snapshot.id ? { ...s, linkedWindowId: windowId } : s)),
    );
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

  return (
    <>
      <h1>TabBuddy Dashboard</h1>
      {snapshots.length === 0 ? (
        <p>No snapshots saved yet.</p>
      ) : (
        <ul>
          {snapshots.map((snapshot) => (
            <li key={snapshot.id}>
              {snapshot.name} — {snapshot.tabs.length} tabs{' '}
              <button onClick={() => handleOpen(snapshot)}>Open</button>{' '}
              <button onClick={() => handleUpdate(snapshot)}>Update</button>{' '}
              <button onClick={() => handleDelete(snapshot)}>Delete</button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default App;
