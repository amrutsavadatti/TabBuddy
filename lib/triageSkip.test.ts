import { describe, expect, it } from 'vitest';
import { countSkipped, isTypingTarget, shouldCloseWindowAtEnd } from './triageSkip';

describe('countSkipped', () => {
  it('counts only the skip steps', () => {
    expect(countSkipped([])).toBe(0);
    expect(countSkipped([{ type: 'delete' }, { type: 'file' }])).toBe(0);
    expect(countSkipped([{ type: 'skip' }, { type: 'delete' }, { type: 'skip' }])).toBe(2);
  });
});

describe('shouldCloseWindowAtEnd', () => {
  it('closes the window only when nothing was left open', () => {
    expect(shouldCloseWindowAtEnd(0)).toBe(true);
    expect(shouldCloseWindowAtEnd(1)).toBe(false);
    expect(shouldCloseWindowAtEnd(30)).toBe(false);
  });
});

describe('isTypingTarget', () => {
  it('is true for text fields and editable content, false for anything else', () => {
    expect(isTypingTarget(document.createElement('input'))).toBe(true);
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true);
    expect(isTypingTarget(document.createElement('select'))).toBe(true);
    expect(isTypingTarget({ isContentEditable: true } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget(document.createElement('button'))).toBe(false);
    expect(isTypingTarget(document.body)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
