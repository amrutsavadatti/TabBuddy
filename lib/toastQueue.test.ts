import { describe, expect, it } from 'vitest';
import { addToast, pruneExpiredToasts, removeToast } from './toastQueue';

describe('addToast', () => {
  it('appends a toast, keeping existing ones', () => {
    const withOne = addToast([], 'a', 'First', 1000);
    const withTwo = addToast(withOne, 'b', 'Second', 1001);
    expect(withTwo).toEqual([
      { id: 'a', message: 'First', createdAt: 1000 },
      { id: 'b', message: 'Second', createdAt: 1001 },
    ]);
  });
});

describe('removeToast', () => {
  it('removes only the matching id', () => {
    const toasts = addToast(addToast([], 'a', 'First', 1), 'b', 'Second', 2);
    expect(removeToast(toasts, 'a')).toEqual([{ id: 'b', message: 'Second', createdAt: 2 }]);
  });

  it('removing an unknown id is a no-op', () => {
    const toasts = addToast([], 'a', 'First', 1);
    expect(removeToast(toasts, 'nope')).toEqual(toasts);
  });
});

describe('pruneExpiredToasts', () => {
  it('drops toasts older than the duration, keeps newer ones', () => {
    const toasts = [
      { id: 'a', message: 'Old', createdAt: 0 },
      { id: 'b', message: 'New', createdAt: 900 },
    ];
    expect(pruneExpiredToasts(toasts, 1000, 500)).toEqual([{ id: 'b', message: 'New', createdAt: 900 }]);
  });

  it('keeps everything when nothing has expired', () => {
    const toasts = [{ id: 'a', message: 'X', createdAt: 900 }];
    expect(pruneExpiredToasts(toasts, 1000, 500)).toEqual(toasts);
  });
});
