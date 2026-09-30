import { describe, expect, it } from 'vitest';
import { filterSnapshotsByName, searchSnapshots } from './searchSnapshots';
import { makeSnapshot } from '@/test/factories';

const named = (name: string, extra: Partial<ReturnType<typeof makeSnapshot>> = {}) =>
  makeSnapshot({ name, ...extra });

describe('filterSnapshotsByName', () => {
  const all = [named('Job Hunt'), named('Research'), named('job board notes')];

  it('matches anywhere in the name, ignoring case', () => {
    expect(filterSnapshotsByName(all, 'JOB').map((s) => s.name)).toEqual(['Job Hunt', 'job board notes']);
    expect(filterSnapshotsByName(all, 'arch').map((s) => s.name)).toEqual(['Research']);
  });

  it('ignores spaces around the query', () => {
    expect(filterSnapshotsByName(all, '  research ').map((s) => s.name)).toEqual(['Research']);
  });

  it('keeps everything, in order, for an empty or blank query', () => {
    expect(filterSnapshotsByName(all, '')).toEqual(all);
    expect(filterSnapshotsByName(all, '   ')).toEqual(all);
  });

  it('finds nothing when no name matches', () => {
    expect(filterSnapshotsByName(all, 'zzz')).toEqual([]);
  });
});

describe('searchSnapshots', () => {
  it('finds nothing for an empty or blank query', () => {
    expect(searchSnapshots([named('A')], '')).toEqual([]);
    expect(searchSnapshots([named('A')], '  ')).toEqual([]);
  });

  it('puts names that start with the query first', () => {
    const results = searchSnapshots(
      [named('My job list', { usageCount: 50 }), named('Job Hunt', { usageCount: 1 })],
      'job',
    );
    expect(results.map((s) => s.name)).toEqual(['Job Hunt', 'My job list']);
  });

  it('then orders by how often each was opened, then by recent update', () => {
    const results = searchSnapshots(
      [
        named('a1', { usageCount: 1, updatedAt: 100 }),
        named('a2', { usageCount: 5, updatedAt: 1 }),
        named('a3', { usageCount: 1, updatedAt: 200 }),
      ],
      'a',
    );
    expect(results.map((s) => s.name)).toEqual(['a2', 'a3', 'a1']);
  });

  it('does not reorder the list it was given', () => {
    const input = [named('b match'), named('a match')];
    const copy = [...input];
    searchSnapshots(input, 'match');
    expect(input).toEqual(copy);
  });
});
