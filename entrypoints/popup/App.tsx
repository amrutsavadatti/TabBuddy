import { useEffect, useState } from 'react';
import { createSnapshotFromCurrentWindow } from '@/lib/capture';
import { addSnapshot, getSnapshots } from '@/lib/storage';
import { updateSnapshotFromLiveWindow } from '@/lib/update';
import { generateSnapshotName, getUniqueName } from '@/lib/names';
import { openOrFocusDashboard } from '@/lib/dashboard';
import type { Snapshot } from '@/lib/types';
import { getAccentColor } from '@/lib/color';
import { Button } from '@/components/ui/button';

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
    openOrFocusDashboard();
  };

  const saveWindow = async () => {
    setStatus('saving');
    const existing = await getSnapshots();
    const desiredName = nameInput.trim() || generateSnapshotName();
    const name = getUniqueName(desiredName, existing.map((s) => s.name));
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
    <div className="flex w-72 flex-col gap-3 p-4">
      <h1 className="text-base font-semibold">TabBuddy</h1>

      {linkedSnapshot && (
        <div
          className="flex flex-col gap-2 rounded-xl border-t-4 border-border bg-card p-3"
          style={{ borderTopColor: getAccentColor(linkedSnapshot.name) }}
        >
          <p className="truncate text-base font-semibold">{linkedSnapshot.name}</p>
          <Button
            size="sm"
            onClick={updateLinkedSnapshot}
            disabled={updateStatus === 'updating'}
          >
            {updateStatus === 'updated' ? 'Updated!' : 'Update'}
          </Button>
        </div>
      )}

      {!linkedSnapshot && (
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
          <input
            className="rounded-lg border border-border bg-background px-2 py-1 text-sm"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            disabled={status === 'saving'}
          />
          <Button size="sm" onClick={saveWindow} disabled={status === 'saving'}>
            {status === 'saved' ? 'Saved!' : 'Save this window'}
          </Button>
        </div>
      )}

      <Button size="sm" variant="outline" onClick={openDashboard}>
        Open dashboard
      </Button>
    </div>
  );
}

export default App;
