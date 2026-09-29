import { describe, expect, it } from 'vitest';
import { MAX_REQUEST_LENGTH } from '../bridge/protocol';
import { parseRequest } from './agentRequest';

describe('parseRequest', () => {
  it('returns the phrase, tidied', () => {
    expect(parseRequest({ request: 'clean up my Job Hunt window' })).toBe('clean up my Job Hunt window');
    expect(parseRequest({ request: '  clean   up\n my window  ' })).toBe('clean up my window');
  });

  it('cuts a phrase that is too long', () => {
    expect(parseRequest({ request: 'x'.repeat(500) })).toHaveLength(MAX_REQUEST_LENGTH);
  });

  it.each([[undefined], [null], [{}], [{ request: '' }], [{ request: '   ' }], [{ request: 5 }], [{ request: ['a'] }]])(
    'ignores %j',
    (params) => expect(parseRequest(params)).toBeUndefined(),
  );
});
