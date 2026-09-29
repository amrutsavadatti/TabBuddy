import { describe, expect, it } from 'vitest';
import { buildTriageUrl, closesWindowWhenDone, parseTriageTabsParam } from './manualTriage';

describe('parseTriageTabsParam', () => {
  it('reads a list of tab ids, once each', () => {
    expect(parseTriageTabsParam('11,12,13')).toEqual([11, 12, 13]);
    expect(parseTriageTabsParam(' 7 , 8 ')).toEqual([7, 8]);
    expect(parseTriageTabsParam('5,5,6')).toEqual([5, 6]);
    expect(parseTriageTabsParam('0')).toEqual([0]);
  });

  it('means the whole window only when the parameter is absent', () => {
    expect(parseTriageTabsParam(null)).toBeNull();
  });

  it('reads anything malformed as an EMPTY list, never as the whole window', () => {
    // falling back to the whole window would show every tab and close the window at the end
    for (const raw of ['', ',', '1,x', 'abc', '1;2', '-3', '1.5', '1,,2', '99999999999999999999']) {
      expect(parseTriageTabsParam(raw)).toEqual([]);
    }
  });
});

describe('buildTriageUrl', () => {
  it('addresses a whole window with just its id', () => {
    expect(buildTriageUrl('/dashboard.html', 42)).toBe('/dashboard.html?triage=42');
  });

  it('adds the handed-over tabs', () => {
    expect(buildTriageUrl('/dashboard.html', 42, [3, 4, 5])).toBe('/dashboard.html?triage=42&tabs=3,4,5');
  });

  it('round-trips through the parser', () => {
    const url = new URL(buildTriageUrl('/dashboard.html', 42, [3, 4, 5]), 'https://x.test');
    expect(parseTriageTabsParam(url.searchParams.get('tabs'))).toEqual([3, 4, 5]);
    expect(parseTriageTabsParam(new URL(buildTriageUrl('/dashboard.html', 42), 'https://x.test').searchParams.get('tabs'))).toBeNull();
  });
});

describe('closesWindowWhenDone', () => {
  it('closes the window after a whole-window session, and never after a handed-over list', () => {
    expect(closesWindowWhenDone(null)).toBe(true);
    expect(closesWindowWhenDone([1, 2])).toBe(false);
    expect(closesWindowWhenDone([])).toBe(false); // an empty list must not close anything either
  });
});
