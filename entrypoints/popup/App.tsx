import { useEffect, useState } from 'react';
import { createSnapshotFromCurrentWindow } from '@/lib/capture';
import { addSnapshot, getSnapshots } from '@/lib/storage';
import { updateSnapshotFromLiveWindow } from '@/lib/update';
import { generateSnapshotName } from '@/lib/names';
import type { Snapshot } from '@/lib/types';

function App() {
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'updating' | 'updated'>('idle');
  const [linkedSnapshot, setLinkedSnapshot] = useState<Snapshot | null>(null);
  const [nameInput, setNameInput] = useState(() => generateSnapshotName());

  useEffect(() => {
    (async () => {
      const currentWindow = await browser.windows.getCurrent();
      const snapshots = await getSnapshots();
      const match = snapshots.find((s) => s.linkedWindowId === currentWindow.id);
      setLinkedSnapshot(match ?? null);
    })();
  }, []);

  const openDashboard = () => {
    browser.tabs.create({ url: browser.runtime.getURL('/dashboard.html') });
  };

  const saveWindow = async () => {
    setStatus('saving');
    const name = nameInput.trim() || generateSnapshotName();
    const snapshot = await createSnapshotFromCurrentWindow(name);
    await addSnapshot(snapshot);
    setStatus('saved');
  };

  const updateLinkedSnapshot = async () => {
    if (!linkedSnapshot) return;
    setUpdateStatus('updating');
    await updateSnapshotFromLiveWindow(linkedSnapshot);
    setUpdateStatus('updated');
  };

  return (
    <>
      <h1>TabBuddy</h1>
      {linkedSnapshot && (
        <div>
          <p>{linkedSnapshot.name}</p>
          <button onClick={updateLinkedSnapshot} disabled={updateStatus === 'updating'}>
            {updateStatus === 'updated' ? 'Updated!' : 'Update'}
          </button>
        </div>
      )}
      <div>
        <input
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          disabled={status === 'saving'}
        />
        <button onClick={saveWindow} disabled={status === 'saving'}>
          {status === 'saved' ? 'Saved!' : 'Save this window'}
        </button>
      </div>
      <button onClick={openDashboard}>Open dashboard</button>
    </>
  );
}

export default App;
