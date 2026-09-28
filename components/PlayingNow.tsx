import { useEffect, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import {
  focusPlayingTab,
  getPlayingTabs,
  setTabMuted,
  type PlayingTab,
} from '@/lib/audibleTabs';

/** Tabs making sound right now, kept up to date while the page is open. */
export function usePlayingTabs(): { tabs: PlayingTab[]; refresh: () => void } {
  const [tabs, setTabs] = useState<PlayingTab[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      getPlayingTabs()
        .then((list) => {
          if (!cancelled) setTabs(list);
        })
        .catch(() => {});
    };
    refresh();
    const onUpdated = (
      _tabId: number,
      info: { audible?: boolean; mutedInfo?: unknown },
    ) => {
      if (info.audible !== undefined || info.mutedInfo !== undefined) refresh();
    };
    browser.tabs.onUpdated.addListener(onUpdated);
    browser.tabs.onRemoved.addListener(refresh);
    return () => {
      cancelled = true;
      browser.tabs.onUpdated.removeListener(onUpdated);
      browser.tabs.onRemoved.removeListener(refresh);
    };
  }, [tick]);

  return { tabs, refresh: () => setTick((n) => n + 1) };
}

/** The list itself: click a row to jump to that tab, or use the speaker to
 * mute it. Renders nothing when no tab is making sound. */
export function PlayingNow({
  tabs,
  onChanged,
  onJumped,
}: {
  tabs: PlayingTab[];
  onChanged: () => void;
  onJumped?: () => void;
}) {
  if (tabs.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-card p-2.5">
      <p className="flex items-center gap-1.5 px-1 text-xs font-semibold text-muted-foreground">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        Playing now
      </p>
      {tabs.map((tab) => (
        <PlayingRow key={tab.id} tab={tab} onChanged={onChanged} onJumped={onJumped} />
      ))}
    </div>
  );
}

function PlayingRow({
  tab,
  onChanged,
  onJumped,
}: {
  tab: PlayingTab;
  onChanged: () => void;
  onJumped?: () => void;
}) {
  const [iconFailed, setIconFailed] = useState(false);

  return (
    <div className="flex items-center gap-1 rounded-lg hover:bg-muted">
      <button
        type="button"
        onClick={async () => {
          await focusPlayingTab(tab);
          onJumped?.();
        }}
        title={`Go to: ${tab.title}`}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {tab.favIconUrl && !iconFailed ? (
          <img
            src={tab.favIconUrl}
            alt=""
            className="h-4 w-4 shrink-0 rounded-sm"
            onError={() => setIconFailed(true)}
          />
        ) : (
          <span className="h-4 w-4 shrink-0 rounded-sm bg-muted" />
        )}
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{tab.title}</span>
      </button>
      <button
        type="button"
        onClick={async () => {
          await setTabMuted(tab.id, !tab.muted);
          onChanged();
        }}
        title={tab.muted ? 'Unmute this tab' : 'Mute this tab'}
        aria-label={tab.muted ? 'Unmute this tab' : 'Mute this tab'}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
      >
        {tab.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
      </button>
    </div>
  );
}
