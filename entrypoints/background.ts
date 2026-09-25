import { openOrFocusDashboard } from '@/lib/dashboard';
import { ensureArchivedSnapshotExists } from '@/lib/archive';
import { unmanageTab } from '@/lib/managedTabs';
import { clearAllWindowLinks, reconcileAfterReload } from '@/lib/reconcile';
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
import { closeNudgesFor, openNextNudge } from '@/lib/nudgeWindow';

export default defineBackground(() => {
  ensureArchivedSnapshotExists();

  // Browser launch resets window/tab ids; an extension reload/update keeps
  // them but empties the session registry.
  browser.runtime.onStartup.addListener(() => {
    clearAllWindowLinks();
  });
  browser.runtime.onInstalled.addListener(() => {
    reconcileAfterReload();
  });

  // Tabs closed (or opened by the user) while a nudge is asking about them:
  // close that nudge so it can never block the next one.
  browser.tabs.onRemoved.addListener((tabId) => {
    closeNudgesFor(tabId);
    unmanageTab(tabId);
    forgetAsked(tabId);
  });
  browser.tabs.onActivated.addListener(({ tabId }) => {
    closeNudgesFor(tabId);
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
    if (inactivityThresholdMs === undefined) {
      const intervalMs = (await getNudgeIntervalMinutes()) * 60_000;
      const idleState = await browser.idle.queryState(AWAY_AFTER_SECONDS);
      if (!(await checkNudgeGate(idleState, intervalMs))) return;
    }
    const threshold = inactivityThresholdMs ?? (await getNudgeStaleMinutes()) * 60_000;
    const candidates = await runNudgeScan(threshold);
    // Least recently asked first, so a dismissed tab goes to the back of the
    // line. openNextNudge does nothing while a nudge popup is already open.
    const ordered = orderByLeastRecentlyAsked(
      candidates.map((c) => c.id),
      await getAskedMap(),
    );
    await openNextNudge(ordered);
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
  //
  // Important for testing: don't run this from a fullscreen DevTools
  // panel — the popup can inherit that fullscreen state. Keep DevTools
  // windowed when testing this.
  (self as unknown as { runNudgeScanNow: typeof scanAndMaybeNudge }).runNudgeScanNow =
    scanAndMaybeNudge;
});
