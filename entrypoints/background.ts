import { openOrFocusDashboard } from '@/lib/dashboard';
import { ensureArchivedSnapshotExists } from '@/lib/archive';
import { createNudgeQueue } from '@/lib/nudgeQueue';
import { runNudgeScan } from '@/lib/nudgeRunner';
import { getNudgeEnabled, getNudgeIntervalMinutes, NUDGE_INTERVAL_KEY } from '@/lib/nudgeSettings';
import { openNudgeForTab } from '@/lib/nudgeWindow';

const NUDGE_ALARM_NAME = 'tabbuddy-nudge-scan';

export default defineBackground(() => {
  ensureArchivedSnapshotExists();

  let activeNudgeWindowId: number | null = null;
  const nudgeQueue = createNudgeQueue();

  // At most one nudge popup at a time, and at most one per scan (every
  // NUDGE_SCAN_PERIOD_MINUTES) — closing a popup does NOT immediately open
  // the next queued tab. Extra candidates found in a scan just wait in the
  // queue for a later scan, one tab per tick.
  const openNextInQueue = async () => {
    if (activeNudgeWindowId !== null) return;
    const nextId = nudgeQueue.dequeue();
    if (nextId === undefined) return;
    const windowId = await openNudgeForTab(nextId);
    activeNudgeWindowId = windowId ?? null;
  };

  browser.windows.onRemoved.addListener((windowId) => {
    if (windowId === activeNudgeWindowId) {
      activeNudgeWindowId = null;
    }
  });

  // Drop a tab from the queue if it's closed some other way before its
  // nudge comes up (e.g. the user closes it manually).
  browser.tabs.onRemoved.addListener((tabId) => {
    nudgeQueue.remove(tabId);
  });

  const scanAndMaybeNudge = async (inactivityThresholdMs?: number) => {
    if (!(await getNudgeEnabled())) return;
    const candidates = await runNudgeScan(inactivityThresholdMs);
    nudgeQueue.enqueueMany(candidates.map((c) => c.id));
    await openNextInQueue();
  };

  browser.commands.onCommand.addListener((command) => {
    if (command === 'open-dashboard') {
      openOrFocusDashboard();
    }
  });

  // (Re)creating an alarm with the same name replaces it, so this can be
  // called again whenever the user changes the interval in the dashboard.
  const createNudgeAlarm = async () => {
    const periodInMinutes = await getNudgeIntervalMinutes();
    browser.alarms.create(NUDGE_ALARM_NAME, { periodInMinutes });
  };
  createNudgeAlarm();

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && NUDGE_INTERVAL_KEY in changes) {
      createNudgeAlarm();
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
