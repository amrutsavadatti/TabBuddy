import { describe, expect, it } from 'vitest';
import { createNudgeQueue } from './nudgeQueue';

describe('createNudgeQueue', () => {
  it('starts empty', () => {
    const queue = createNudgeQueue();
    expect(queue.peekAll()).toEqual([]);
    expect(queue.dequeue()).toBeUndefined();
  });

  it('dequeues in FIFO order', () => {
    const queue = createNudgeQueue();
    queue.enqueueMany([1, 2, 3]);
    expect(queue.dequeue()).toBe(1);
    expect(queue.dequeue()).toBe(2);
    expect(queue.dequeue()).toBe(3);
    expect(queue.dequeue()).toBeUndefined();
  });

  it('deduplicates ids already in the queue', () => {
    const queue = createNudgeQueue();
    queue.enqueueMany([1, 2]);
    queue.enqueueMany([2, 3]);
    expect(queue.peekAll()).toEqual([1, 2, 3]);
  });

  it('removes a specific id, preserving order of the rest', () => {
    const queue = createNudgeQueue();
    queue.enqueueMany([1, 2, 3]);
    queue.remove(2);
    expect(queue.peekAll()).toEqual([1, 3]);
  });

  it('removing an id not in the queue is a no-op', () => {
    const queue = createNudgeQueue();
    queue.enqueueMany([1, 2]);
    queue.remove(999);
    expect(queue.peekAll()).toEqual([1, 2]);
  });

  it('allows re-enqueuing an id after it has been dequeued', () => {
    const queue = createNudgeQueue();
    queue.enqueueMany([1]);
    queue.dequeue();
    queue.enqueueMany([1]);
    expect(queue.peekAll()).toEqual([1]);
  });
});
