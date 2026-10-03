/** Skipping leaves a tab exactly as it is (open, and in no snapshot), so the
 * sorting screen has to remember which tabs it left open: they decide whether
 * the window may be closed at the end. Pure, so the rules are easy to test. */

export function countSkipped(history: readonly { type: string }[]): number {
  return history.filter((step) => step.type === 'skip').length;
}

/** At the end of a session the window is closed only if every tab in it was
 * closed or filed away. A skipped tab is still in it, and must survive. */
export function shouldCloseWindowAtEnd(skippedCount: number): boolean {
  return skippedCount === 0;
}

/** True when a key press is going into a text field, where a shortcut like
 * "S" must be left alone (renaming a snapshot, for one). */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null;
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true;
}
