import { useEffect, useState } from 'react';
import { createSnapshotFromCurrentWindow } from '@/lib/capture';
import { addSnapshot, getSnapshots } from '@/lib/storage';
import { updateSnapshotFromLiveWindow } from '@/lib/update';
import type { Snapshot } from '@/lib/types';

function App() {
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'updating' | 'updated'>('idle');
  const [linkedSnapshot, setLinkedSnapshot] = useState<Snapshot | null>(null);

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
    const snapshot = await createSnapshotFromCurrentWindow('Untitled');
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
      <button onClick={saveWindow} disabled={status === 'saving'}>
        {status === 'saved' ? 'Saved!' : 'Save this window'}
      </button>
      <button onClick={openDashboard}>Open dashboard</button>
    </>
  );
}

export default App;
