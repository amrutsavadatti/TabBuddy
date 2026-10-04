import { openOrFocusDashboard } from '@/lib/dashboard';
import { ensureArchivedSnapshotExists } from '@/lib/archive';
import { unmanageTab } from '@/lib/managedTabs';
import { clearAllWindowLinks, reconcileAfterReload } from '@/lib/reconcile';
import { recordSiteVisit } from '@/lib/siteStats';
import { updatePlayingBadge } from '@/lib/playingBadge';
import { forgetAsked, getAskedMap, orderByLeastRecentlyAsked } from '@/lib/nudgeAsked';
import { runNudgeScan } from '@/lib/nudgeRunner';
import {
  getNudgeEnabled,
  getNudgeIntervalMinutes,
  getNudgeStaleMinutes,
  NUDGE_INTERVAL_KEY,
} from '@/lib/nudgeSettings';
import { ensureNudgeAlarm, NUDGE_ALARM_NAME } from '@/lib/nudgeAlarm';
import { AWAY_AFTER_SECONDS, checkNudgeGate, noteReturnedFromAway } from '@/lib/nudgeGate';
import { clearPendingNudgeFor, expireIgnoredNudge, presentNextNudge } from '@/lib/nudgePending';

export default defineBackground(() => {
  ensureArchivedSnapshotExists();
  updatePlayingBadge().catch(() => {});

  // Browser launch resets window/tab ids; an extension reload/update keeps
  // them but empties the session registry.
  browser.runtime.onStartup.addListener(() => {
    clearAllWindowLinks();
  });
  browser.runtime.onInstalled.addListener(() => {
    reconcileAfterReload();
  });

  // A tab closed while a nudge is asking about it: drop that question so it
  // can never block the next one. (Switching to the tab doesn't count — the
  // nudge itself does that to point the user at it.)
  browser.tabs.onRemoved.addListener((tabId) => {
    updatePlayingBadge().catch(() => {});
    clearPendingNudgeFor(tabId);
    unmanageTab(tabId);
    forgetAsked(tabId);
  });
  browser.tabs.onActivated.addListener(async ({ tabId }) => {
    // Quick links: switching to a tab counts as a visit to its site.
    try {
      const tab = await browser.tabs.get(tabId);
      if (!tab.incognito) recordSiteVisit(tab.url, tab.favIconUrl);
    } catch {
      // tab closed before we could look at it
    }
  });
  // A page that finishes loading (or gets its icon) in the tab the user is
  // looking at also counts. Background loads, like a restored snapshot, do not.
  browser.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    // Toolbar badge: tabs starting or stopping sound (or being muted).
    if (changeInfo.audible !== undefined || changeInfo.mutedInfo !== undefined) {
      updatePlayingBadge().catch(() => {});
    }
    if (!tab.active || tab.incognito) return;
    if (changeInfo.status === 'complete' || changeInfo.favIconUrl) {
      recordSiteVisit(tab.url, tab.favIconUrl);
    }
  });

  // When the user comes back from being away (idle or locked), stay quiet for
  // one full interval so opening the laptop doesn't trigger an instant popup.
  browser.idle.setDetectionInterval(AWAY_AFTER_SECONDS);
  browser.idle.onStateChanged.addListener(async (state) => {
    if (state === 'active') {
      noteReturnedFromAway((await getNudgeIntervalMinutes()) * 60_000);
    }
  });

  // `inactivityThresholdMs` is only passed by the manual dev trigger; that
  // path skips the away/quiet gate so it can be tested on demand.
  const scanAndMaybeNudge = async (inactivityThresholdMs?: number) => {
    if (!(await getNudgeEnabled())) return;
    const intervalMs = (await getNudgeIntervalMinutes()) * 60_000;
    if (inactivityThresholdMs === undefined) {
      const idleState = await browser.idle.queryState(AWAY_AFTER_SECONDS);
      if (!(await checkNudgeGate(idleState, intervalMs))) return;
    }
    // If the previous nudge was ignored for a full interval, move on.
    await expireIgnoredNudge(intervalMs);
    const threshold = inactivityThresholdMs ?? (await getNudgeStaleMinutes()) * 60_000;
    const candidates = await runNudgeScan(threshold);
    // Least recently asked first, so a dismissed tab goes to the back of the
    // line. presentNextNudge does nothing while a question is still waiting.
    const ordered = orderByLeastRecentlyAsked(
      candidates.map((c) => c.id),
      await getAskedMap(),
    );
    await presentNextNudge(ordered);
  };

  browser.commands.onCommand.addListener((command) => {
    if (command === 'open-dashboard') {
      openOrFocusDashboard();
    }
  });

  const syncNudgeAlarm = async () => {
    await ensureNudgeAlarm(await getNudgeIntervalMinutes());
  };
  syncNudgeAlarm();

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && NUDGE_INTERVAL_KEY in changes) {
      syncNudgeAlarm();
    }
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === NUDGE_ALARM_NAME) {
      scanAndMaybeNudge();
    }
  });

  // Dev/manual trigger: from the service worker's inspected console
  // (chrome://extensions -> TabBuddy -> "service worker"), run
  // `runNudgeScanNow()` to test without waiting for the real alarm, or
  // `runNudgeScanNow(60_000)` to treat 1-minute-old tabs as stale.
  // Needs a focused browser window for the toolbar popup to auto-open.
  (self as unknown as { runNudgeScanNow: typeof scanAndMaybeNudge }).runNudgeScanNow =
    scanAndMaybeNudge;
});
