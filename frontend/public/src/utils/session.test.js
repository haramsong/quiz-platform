import { describe, test, expect } from 'vitest';
import {
  tokenKey, loadToken, saveToken, clearToken, isReconnectToken, playerIdFromToken,
} from './session.js';

// Minimal in-memory store matching the localStorage getItem/setItem/removeItem API.
function fakeStore(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _dump: () => Object.fromEntries(m),
  };
}

test('tokenKey: namespaced per code', () => {
  expect(tokenKey('ABCD')).toBe('qp_token_ABCD');
});

describe('load/save/clear round-trip', () => {
  test('save then load returns the token', () => {
    const s = fakeStore();
    saveToken('ABCD', 'ABCD:p1', s);
    expect(loadToken('ABCD', s)).toBe('ABCD:p1');
  });

  test('clear removes it', () => {
    const s = fakeStore({ 'qp_token_ABCD': 'ABCD:p1' });
    clearToken('ABCD', s);
    expect(loadToken('ABCD', s)).toBe('');
  });

  test('load missing code → empty string', () => {
    expect(loadToken('NOPE', fakeStore())).toBe('');
  });

  test('save ignores empty code/token', () => {
    const s = fakeStore();
    saveToken('', 'x', s);
    saveToken('ABCD', '', s);
    expect(s._dump()).toEqual({});
  });

  test('tokens are isolated per code', () => {
    const s = fakeStore();
    saveToken('AAAA', 'AAAA:p1', s);
    saveToken('BBBB', 'BBBB:p2', s);
    expect(loadToken('AAAA', s)).toBe('AAAA:p1');
    expect(loadToken('BBBB', s)).toBe('BBBB:p2');
    clearToken('AAAA', s);
    expect(loadToken('AAAA', s)).toBe('');
    expect(loadToken('BBBB', s)).toBe('BBBB:p2'); // untouched
  });
});

test('helpers no-op gracefully when store is null (SSR/blocked storage)', () => {
  expect(loadToken('ABCD', null)).toBe('');
  expect(() => saveToken('ABCD', 'ABCD:p1', null)).not.toThrow();
  expect(() => clearToken('ABCD', null)).not.toThrow();
});

describe('isReconnectToken', () => {
  test('true only for a token belonging to this code', () => {
    expect(isReconnectToken('ABCD:p1', 'ABCD')).toBe(true);
    expect(isReconnectToken('WXYZ:p1', 'ABCD')).toBe(false); // foreign code
    expect(isReconnectToken('', 'ABCD')).toBe(false);
    expect(isReconnectToken('ABCD:p1', '')).toBe(false);
    expect(isReconnectToken(null, 'ABCD')).toBe(false);
  });
});

describe('playerIdFromToken', () => {
  test('extracts the playerId half', () => {
    expect(playerIdFromToken('ABCD:p_123')).toBe('p_123');
    expect(playerIdFromToken('ABCD:a:b')).toBe('a:b'); // only first colon splits
  });
  test('null/odd inputs', () => {
    expect(playerIdFromToken('')).toBeNull();
    expect(playerIdFromToken(null)).toBeNull();
    expect(playerIdFromToken('nocolon')).toBeNull();
  });
});
