import { describe, expect, it } from 'vitest';
import { pageKey } from './pageKey';

const same = (a: string, b: string) => expect(pageKey(a)).toBe(pageKey(b));
const different = (a: string, b: string) => expect(pageKey(a)).not.toBe(pageKey(b));

describe('pageKey', () => {
  it('ignores www, scheme, host case and a trailing slash', () => {
    same('https://www.Example.com/docs/', 'http://example.com/docs');
    same('https://example.com', 'https://example.com/');
  });

  it('ignores tracking parameters but keeps the meaningful ones', () => {
    same('https://a.test/p?id=5&utm_source=x&fbclid=abc', 'https://a.test/p?id=5');
    same('https://a.test/p?gclid=1&UTM_Campaign=z', 'https://a.test/p');
    different('https://a.test/p?id=5', 'https://a.test/p?id=6');
  });

  it('ignores the order of parameters', () => {
    same('https://a.test/s?a=1&b=2', 'https://a.test/s?b=2&a=1');
  });

  it('ignores a plain #fragment but keeps a route-style one', () => {
    same('https://a.test/page#section-2', 'https://a.test/page');
    different('https://mail.test/#/inbox', 'https://mail.test/#/sent');
    different('https://a.test/#!/one', 'https://a.test/#!/two');
  });

  it('keeps different paths, hosts, ports and subdomains apart', () => {
    different('https://a.test/one', 'https://a.test/two');
    different('https://a.test/', 'https://b.test/');
    different('https://a.test:8080/', 'https://a.test/');
    different('https://docs.a.test/', 'https://a.test/');
  });

  it('returns null for anything that is not a web address', () => {
    for (const bad of ['chrome://settings', 'file:///tmp/x', 'about:blank', 'not a url', '', 'javascript:1']) {
      expect(pageKey(bad)).toBeNull();
    }
  });
});
