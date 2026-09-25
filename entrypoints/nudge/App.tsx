import { useEffect, useState } from 'react';
import { snoozeUrl } from '@/lib/nudgeState';
import { archiveTab } from '@/lib/archive';
import { getAccentColor } from '@/lib/color';
import { Button } from '@/components/ui/button';

interface TabInfo {
  id: number;
  title: string;
  url: string;
  favIconUrl?: string;
  pinned: boolean;
}

function getTabIdFromQuery(): number | null {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('tabId');
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/** Full-bleed backdrop: a soft, off-center accent glow so a large canvas
 * (this can render fullscreen if the browser itself is in native
 * fullscreen when a nudge fires) reads as an intentional moment rather
 * than a small box lost in empty space. */
function Backdrop({ accent }: { accent: string }) {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden bg-background">
      <div
        className="absolute left-1/2 top-1/2 h-[70vmin] w-[70vmin] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-40 blur-[100px]"
        style={{ backgroundColor: accent }}
      />
    </div>
  );
}

function App() {
  const [tab, setTab] = useState<TabInfo | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const tabId = getTabIdFromQuery();
    if (tabId === null) {
      setNotFound(true);
      return;
    }
    browser.tabs.get(tabId).then(
      (t) =>
        setTab({
          id: tabId,
          title: t.title ?? '',
          url: t.url ?? '',
          favIconUrl: t.favIconUrl,
          pinned: t.pinned ?? false,
        }),
      () => setNotFound(true), // tab was closed before the nudge could show
    );
  }, []);

  const closeTab = async (tabId: number) => {
    try {
      await browser.tabs.remove(tabId);
    } catch {
      // already closed by the user in the meantime — fine either way
    }
  };

  const handleClose = async () => {
    if (!tab) return;
    await closeTab(tab.id);
    window.close();
  };

  const handleKeep = async () => {
    if (!tab) return;
    await snoozeUrl(tab.url);
    window.close();
  };

  const handleArchiveAndClose = async () => {
    if (!tab) return;
    await archiveTab(tab);
    window.close();
  };

  if (notFound) {
    return (
      <div className="relative flex h-screen flex-col items-center justify-center gap-3 p-5 text-center">
        <Backdrop accent="var(--muted-foreground)" />
        <p className="relative text-sm text-muted-foreground">
          This tab isn't open anymore.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="relative"
          onClick={() => window.close()}
        >
          Close
        </Button>
      </div>
    );
  }

  if (!tab) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  const accent = getAccentColor(tab.title || tab.url);

  return (
    <div className="relative flex h-screen w-screen items-center justify-center p-6">
      <Backdrop accent={accent} />

      <div className="relative flex w-full max-w-lg flex-col items-center gap-6 rounded-2xl border border-border bg-card p-10 text-center shadow-2xl">
        {tab.favIconUrl ? (
          <img src={tab.favIconUrl} alt="" className="h-16 w-16 rounded-xl" />
        ) : (
          <div className="h-16 w-16 rounded-xl bg-muted" />
        )}

        <div className="w-full">
          <p className="line-clamp-2 text-lg font-semibold">{tab.title || tab.url}</p>
          <p className="mt-1 truncate text-sm text-muted-foreground">{tab.url}</p>
        </div>

        <p className="text-2xl font-bold tracking-tight">
          Let's declutter. Want to close this?
        </p>

        <div className="flex w-full flex-wrap items-center justify-center gap-3">
          <Button variant="outline" onClick={handleClose} className="w-36">
            Close
          </Button>
          <Button variant="outline" onClick={handleArchiveAndClose} className="w-36">
            Archive &amp; Close
          </Button>
          <Button variant="outline" onClick={handleKeep} className="w-36">
            Keep
          </Button>
        </div>
      </div>
    </div>
  );
}

export default App;
