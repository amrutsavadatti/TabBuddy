import { useEffect, useState } from 'react';
import { createSnapshotFromCurrentWindow } from '@/lib/capture';
import { addSnapshot, getSnapshots } from '@/lib/storage';
import { updateSnapshotFromLiveWindow } from '@/lib/update';
import { restoreSnapshot } from '@/lib/restore';
import { getMostUsedSnapshots } from '@/lib/sort';
import { generateSnapshotName, getUniqueName } from '@/lib/names';
import { openOrFocusDashboard, openTriageSession } from '@/lib/dashboard';
import { autoGroupByDomain } from '@/lib/autoGroup';
import { getStoredVibe } from '@/lib/vibes';
import type { Snapshot } from '@/lib/types';
import { getAccentColor } from '@/lib/color';
import { Button } from '@/components/ui/button';
import { LayoutGrid, Shuffle } from 'lucide-react';
import { PlayingNow, usePlayingTabs } from '@/components/PlayingNow';

const MOST_USED_COUNT = 3;

function App() {
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'updating' | 'updated'>('idle');
  const [linkedSnapshot, setLinkedSnapshot] = useState<Snapshot | null>(null);
  const [mostUsed, setMostUsed] = useState<Snapshot[]>([]);
  const [nameInput, setNameInput] = useState(() => generateSnapshotName());
  const [groupStatus, setGroupStatus] = useState<'idle' | 'grouping' | 'done'>('idle');
  const playing = usePlayingTabs();

  useEffect(() => {
    (async () => {
      const currentWindow = await browser.windows.getCurrent();
      const snapshots = await getSnapshots();
      const match = snapshots.find((s) => s.linkedWindowId === currentWindow.id);
      setLinkedSnapshot(match ?? null);
      // Already shown above with its own Update button — no need to repeat it.
      setMostUsed(
        getMostUsedSnapshots(
          snapshots.filter((s) => s.id !== match?.id),
          MOST_USED_COUNT,
        ),
      );
    })();
    getStoredVibe().then((v) => {
      document.documentElement.dataset.vibe = v;
    });
  }, []);

  const openMostUsed = async (snapshot: Snapshot) => {
    await restoreSnapshot(snapshot);
    window.close();
  };

  const openDashboard = () => {
    openOrFocusDashboard();
  };

  const sortTabs = async () => {
    const currentWindow = await browser.windows.getCurrent();
    if (currentWindow.id !== undefined) {
      await openTriageSession(currentWindow.id);
    }
  };

  const groupBySite = async () => {
    const currentWindow = await browser.windows.getCurrent();
    if (currentWindow.id === undefined) return;
    setGroupStatus('grouping');
    await autoGroupByDomain(currentWindow.id);
    setGroupStatus('done');
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

      <PlayingNow tabs={playing.tabs} onChanged={playing.refresh} onJumped={() => window.close()} />

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

      {mostUsed.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="px-1 text-xs font-medium text-muted-foreground">Most used</p>
          {mostUsed.map((s) => (
            <button
              key={s.id}
              onClick={() => openMostUsed(s)}
              title={`Open "${s.name}"`}
              className="flex items-center gap-2 rounded-lg border-t-4 border-border bg-card px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted"
              style={{ borderTopColor: getAccentColor(s.name) }}
            >
              <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {s.tabs.length} tab{s.tabs.length === 1 ? '' : 's'}
              </span>
            </button>
          ))}
        </div>
      )}

      <Button size="sm" variant="outline" onClick={openDashboard}>
        Open dashboard
      </Button>
      <Button size="sm" variant="outline" onClick={sortTabs}>
        <Shuffle size={14} className="mr-1" /> Sort tabs
      </Button>
      <Button size="sm" variant="outline" onClick={groupBySite} disabled={groupStatus === 'grouping'}>
        <LayoutGrid size={14} className="mr-1" />
        {groupStatus === 'done' ? 'Grouped!' : 'Group by site'}
      </Button>
    </div>
  );
}

export default App;
