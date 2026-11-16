// Release V1 · B4 (F1/F3 unit level): the gateway key lives in MEMORY ONLY.
// This file defines the NEW contract that supersedes the old "key in localStorage['nexus_gateway_key']" case
// of settings.test.mjs (see baseline/evidence/release-v1-b4-superseded-tests.md).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getGatewayKey, setGatewayKey, purgeLegacyGatewayKey } from './settings.mjs';

const SECRET = 'LAN-test-key-aaaaaaaaaaaa-0001';
const LEGACY = 'nexus_gateway_key';

function allStoredText() {
  const out = [];
  for (const s of [localStorage, sessionStorage]) {
    for (let i = 0; i < s.length; i++) { const k = s.key(i); out.push(k, s.getItem(k)); }
  }
  return out.join('\n');
}

beforeEach(() => {
  setGatewayKey('');
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('gateway key is held in memory only', () => {
  it('defaults to empty', () => { expect(getGatewayKey()).toBe(''); });

  it('setGatewayKey makes getGatewayKey return the (trimmed) key', () => {
    setGatewayKey('  ' + SECRET + '  ');
    expect(getGatewayKey()).toBe(SECRET);
  });

  it('setGatewayKey("") and non-strings clear it', () => {
    setGatewayKey(SECRET);
    setGatewayKey('');
    expect(getGatewayKey()).toBe('');
    setGatewayKey(SECRET);
    setGatewayKey(undefined);
    expect(getGatewayKey()).toBe('');
    setGatewayKey(SECRET);
    setGatewayKey(null);
    expect(getGatewayKey()).toBe('');
  });

  it('setting and reading the key writes NOTHING to localStorage or sessionStorage (spied + scanned)', () => {
    const lsSet = vi.spyOn(Storage.prototype, 'setItem');
    setGatewayKey(SECRET);
    expect(getGatewayKey()).toBe(SECRET);
    expect(lsSet).not.toHaveBeenCalled();
    expect(allStoredText()).not.toContain(SECRET);
    expect(localStorage.getItem(LEGACY)).toBeNull();
    expect(sessionStorage.getItem(LEGACY)).toBeNull();
  });

  it('getGatewayKey does NOT adopt a legacy persisted value (no silent migration)', () => {
    localStorage.setItem(LEGACY, 'old-persisted-key');
    sessionStorage.setItem(LEGACY, 'old-persisted-key-2');
    expect(getGatewayKey()).toBe('');
  });

  it('getGatewayKey never touches storage at all (works even if Storage.getItem throws)', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    setGatewayKey(SECRET);
    expect(getGatewayKey()).toBe(SECRET);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('purgeLegacyGatewayKey', () => {
  it('removes the legacy key from localStorage and sessionStorage and leaves unrelated entries alone', () => {
    localStorage.setItem(LEGACY, 'old');
    sessionStorage.setItem(LEGACY, 'old');
    localStorage.setItem('nexus_backend_url', 'http://x');
    purgeLegacyGatewayKey();
    expect(localStorage.getItem(LEGACY)).toBeNull();
    expect(sessionStorage.getItem(LEGACY)).toBeNull();
    expect(localStorage.getItem('nexus_backend_url')).toBe('http://x');
  });

  it('does not clear the in-memory key', () => {
    setGatewayKey(SECRET);
    purgeLegacyGatewayKey();
    expect(getGatewayKey()).toBe(SECRET);
  });

  it('is safe when storage throws (Safari private mode, blocked storage)', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => purgeLegacyGatewayKey()).not.toThrow();
  });
});
