import { useEffect, useState } from 'react';
import { getSnapshots } from '@/lib/storage';
import { restoreSnapshot } from '@/lib/restore';
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
              <button onClick={() => handleOpen(snapshot)}>Open</button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default App;
