/** FIFO queue of tab ids waiting for a nudge popup, used when a scan finds
 * more unimportant tabs than can be shown at once (only one nudge popup is
 * open at a time). */
export interface NudgeQueue {
  enqueueMany(ids: number[]): void;
  dequeue(): number | undefined;
  remove(id: number): void;
  peekAll(): number[];
}

export function createNudgeQueue(): NudgeQueue {
  let queue: number[] = [];

  return {
    enqueueMany(ids: number[]) {
      for (const id of ids) {
        if (!queue.includes(id)) queue.push(id);
      }
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
