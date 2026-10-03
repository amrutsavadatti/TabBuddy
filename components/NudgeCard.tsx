import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { archiveTab } from '@/lib/archive';
import {
  clearPendingNudge,
  getPendingNudgeTab,
  jumpToTab,
  PENDING_KEY,
} from '@/lib/nudgePending';
import { snoozeUrl } from '@/lib/nudgeState';
import type { TriageTab } from '@/lib/triage';
import { Button } from '@/components/ui/button';

/** The tab TabBuddy is waiting on a decision about, kept up to date while the
 * page is open: appears when a nudge fires, disappears once it is answered or
 * the tab is closed. */
export function usePendingNudge(): TriageTab | null {
  const [tab, setTab] = useState<TriageTab | null>(null);

  const refresh = useCallback(() => {
    getPendingNudgeTab()
      .then(setTab)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const onChanged = (changes: Record<string, unknown>, area: string) => {
      if (area === 'session' && PENDING_KEY in changes) refresh();
    };
    browser.storage.onChanged.addListener(onChanged);
    browser.tabs.onRemoved.addListener(refresh);
    return () => {
      browser.storage.onChanged.removeListener(onChanged);
      browser.tabs.onRemoved.removeListener(refresh);
    };
  }, [refresh]);

  return tab;
}

/** The "close this stale tab?" question. The header jumps to the tab; the
 * buttons decide. `onJumped` / `onDone` let the host react (the toolbar popup
 * closes itself, the dashboard stays put). */
export function NudgeCard({
  tab,
  onJumped,
  onDone,
}: {
  tab: TriageTab;
  onJumped?: () => void;
  onDone?: () => void;
}) {
  const finish = async (action: () => Promise<unknown>) => {
    await action();
    await clearPendingNudge();
    onDone?.();
  };
  const jump = async () => {
    try {
      await jumpToTab(tab.id);
    } catch (err) {
      console.warn('[TabBuddy] could not jump to the nudged tab', err);
    }
    onJumped?.();
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
      <button
        type="button"
        onClick={jump}
        title="Go to this tab"
        className="flex flex-col gap-2 rounded-lg text-left transition-colors hover:bg-muted"
      >
        <span className="flex items-center justify-between text-xs font-medium text-muted-foreground">
          Still need this tab?
          <span className="inline-flex items-center gap-0.5">
            Go to tab <ArrowUpRight size={12} />
          </span>
        </span>
        <span className="flex items-center gap-2">
          {tab.favIconUrl ? (
            <img src={tab.favIconUrl} alt="" className="h-6 w-6 rounded" />
          ) : (
            <span className="h-6 w-6 rounded bg-muted" />
          )}
          <span className="line-clamp-2 min-w-0 flex-1 text-sm font-semibold">
            {tab.title || tab.url}
          </span>
        </span>
      </button>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          onClick={() => finish(() => browser.tabs.remove(tab.id).catch(() => {}))}
        >
          Close
        </Button>
        <Button size="sm" variant="outline" className="flex-1" onClick={() => finish(() => archiveTab(tab))}>
          Archive
        </Button>
        <Button size="sm" className="flex-1" onClick={() => finish(() => snoozeUrl(tab.url))}>
          Keep
        </Button>
      </div>
    </div>
  );
}
