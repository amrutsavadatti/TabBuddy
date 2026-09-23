/** FIFO queue of tab ids waiting for a nudge popup, used when a scan finds
 * more unimportant tabs than can be shown at once (only one nudge popup is
 * open at a time). */
export interface NudgeQueue {
  /** Reconciles the queue with a fresh scan: drops ids that are no longer
   * candidates, keeps the order of ones still waiting, appends new ones. */
  sync(ids: number[]): void;
  clear(): void;
  dequeue(): number | undefined;
  remove(id: number): void;
  peekAll(): number[];
}

export function createNudgeQueue(): NudgeQueue {
  let queue: number[] = [];

  return {
    sync(ids: number[]) {
      const fresh = new Set(ids);
      const kept = queue.filter((id) => fresh.has(id));
      const keptSet = new Set(kept);
      queue = [...new Set([...kept, ...ids.filter((id) => !keptSet.has(id))])];
    },
    clear() {
      queue = [];
    },
    dequeue() {
      return queue.shift();
    },
    remove(id: number) {
      queue = queue.filter((queued) => queued !== id);
    },
    peekAll() {
      return [...queue];
    },
  };
}
