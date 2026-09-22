import { useState } from 'react';
import { createSnapshotFromCurrentWindow } from '@/lib/capture';
import { addSnapshot } from '@/lib/storage';

function App() {
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  const openDashboard = () => {
    browser.tabs.create({ url: browser.runtime.getURL('/dashboard.html') });
  };

  const saveWindow = async () => {
    setStatus('saving');
    const snapshot = await createSnapshotFromCurrentWindow('Untitled');
    await addSnapshot(snapshot);
    setStatus('saved');
  };

  return (
    <>
      <h1>TabBuddy</h1>
      <button onClick={saveWindow} disabled={status === 'saving'}>
        {status === 'saved' ? 'Saved!' : 'Save this window'}
      </button>
      <button onClick={openDashboard}>Open dashboard</button>
    </>
  );
}

export default App;
