import { describe, expect, it } from 'vitest';
import { generateSnapshotName, getUniqueName } from './names';

describe('generateSnapshotName', () => {
  it('matches the adjective-adjective-noun format', () => {
    for (let i = 0; i < 20; i++) {
      expect(generateSnapshotName()).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/);
    }
  });
});

describe('getUniqueName', () => {
  it('returns the name unchanged when not taken', () => {
    expect(getUniqueName('Job Hunt', [])).toBe('Job Hunt');
    expect(getUniqueName('Job Hunt', ['Something Else'])).toBe('Job Hunt');
  });

  it('appends (2) on a single collision', () => {
    expect(getUniqueName('Job Hunt', ['Job Hunt'])).toBe('Job Hunt (2)');
  });

  it('increments past existing numbered collisions', () => {
    expect(getUniqueName('Job Hunt', ['Job Hunt', 'Job Hunt (2)'])).toBe('Job Hunt (3)');
    expect(
      getUniqueName('Job Hunt', ['Job Hunt', 'Job Hunt (2)', 'Job Hunt (3)']),
    ).toBe('Job Hunt (4)');
  });

  it('does not collide with unrelated names containing similar text', () => {
    expect(getUniqueName('Job Hunt', ['Job Hunt 2024'])).toBe('Job Hunt');
  });
});
