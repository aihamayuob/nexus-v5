import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getBackendUrl, getChatModel, getDeviceId, getEnabledExtraProviders, getGatewayKey,
  getLastKnownSyncVersion, getLocalModelName, getMarketContextCurrency,
  getStoredWebAuthnCredentialId, getThemePreference, getUILang, getVoiceLang, getVoiceRate,
  isCloudSyncEnabled, isLongTermMemoryEnabled, isMarketContextEnabled, isThoughtTreeEnabled,
  isToolsEnabled, isVoiceToVoiceMode, isWebAuthnSupported, isStandaloneDisplay,
  setLastKnownSyncVersion, saveLocalModelSetting,
} from './settings.mjs';

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('simple localStorage getters — default when unset, real value when set', () => {
  const cases = [
    [getBackendUrl, 'nexus_backend_url', '', 'http://example.com'],
    [getChatModel, 'nexus_chat_model', 'anthropic', 'openai'],
    // SUPERSEDED (Release V1 · B4, owner directive): getGatewayKey no longer reads localStorage['nexus_gateway_key'] — the key is memory-only.
    // The old case here encoded the persisted-key contract. Replaced by modules/gatewayKey.test.mjs; see baseline/evidence/release-v1-b4-superseded-tests.md.
    [getLocalModelName, 'nexus_local_model_name', '', 'llama3'],
    [getMarketContextCurrency, 'nexus_market_context_currency', 'USD', 'EUR'],
    [getThemePreference, 'nexus_theme', 'auto', 'dark'],
    [getUILang, 'nexus_ui_lang', 'ar', 'en'],
    [getVoiceLang, 'nexus_voice_lang', 'ar-SA', 'en-US'],
  ];
  for (const [fn, key, def, val] of cases) {
    it(`${fn.name}: default "${def}", real value "${val}"`, () => {
      expect(fn()).toBe(def);
      localStorage.setItem(key, val);
      expect(fn()).toBe(val);
    });
  }
});

describe('getDeviceId', () => {
  it('generates and persists a new id on first call', () => {
    const id = getDeviceId();
    expect(id.startsWith('dev_')).toBe(true);
    expect(localStorage.getItem('nexus_device_id')).toBe(id);
  });
  it('returns the same id on subsequent calls', () => {
    const first = getDeviceId();
    const second = getDeviceId();
    expect(second).toBe(first);
  });
});

describe('getEnabledExtraProviders', () => {
  it('returns an empty array when unset', () => {
    expect(getEnabledExtraProviders()).toEqual([]);
  });
  it('parses a stored JSON array', () => {
    localStorage.setItem('nexus_providers', JSON.stringify(['openai', 'gemini']));
    expect(getEnabledExtraProviders()).toEqual(['openai', 'gemini']);
  });
  it('falls back to an empty array on malformed JSON (matches its own try/catch)', () => {
    localStorage.setItem('nexus_providers', '{not valid json');
    expect(getEnabledExtraProviders()).toEqual([]);
  });
});

describe('getLastKnownSyncVersion / setLastKnownSyncVersion', () => {
  it('defaults to 0', () => {
    expect(getLastKnownSyncVersion()).toBe(0);
  });
  it('round-trips a set value as a number', () => {
    setLastKnownSyncVersion(42);
    expect(getLastKnownSyncVersion()).toBe(42);
  });
});

describe('getStoredWebAuthnCredentialId', () => {
  it('returns null when unset (not empty string, matching a getItem-null contract callers may rely on)', () => {
    expect(getStoredWebAuthnCredentialId()).toBeNull();
  });
  it('returns the stored id when set', () => {
    localStorage.setItem('nexus_webauthn_credential_id', 'cred123');
    expect(getStoredWebAuthnCredentialId()).toBe('cred123');
  });
});

describe('getVoiceRate', () => {
  it('defaults to 1', () => {
    expect(getVoiceRate()).toBe(1);
  });
  it('parses a stored float', () => {
    localStorage.setItem('nexus_voice_rate', '1.5');
    expect(getVoiceRate()).toBe(1.5);
  });
});

describe('boolean flag getters (localStorage-backed)', () => {
  it('isCloudSyncEnabled: true only when the value is exactly "1"', () => {
    expect(isCloudSyncEnabled()).toBe(false);
    localStorage.setItem('nexus_sync_enabled', '1');
    expect(isCloudSyncEnabled()).toBe(true);
    localStorage.setItem('nexus_sync_enabled', 'true'); // not "1" -> still false
    expect(isCloudSyncEnabled()).toBe(false);
  });
  it('isLongTermMemoryEnabled: same "1" contract', () => {
    expect(isLongTermMemoryEnabled()).toBe(false);
    localStorage.setItem('nexus_ltm_enabled', '1');
    expect(isLongTermMemoryEnabled()).toBe(true);
  });
  it('isMarketContextEnabled: true only when the value is exactly "true" (different contract from the "1" flags above — preserved as-is, not normalized)', () => {
    expect(isMarketContextEnabled()).toBe(false);
    localStorage.setItem('nexus_market_context_enabled', 'true');
    expect(isMarketContextEnabled()).toBe(true);
    localStorage.setItem('nexus_market_context_enabled', '1'); // not "true" -> still false
    expect(isMarketContextEnabled()).toBe(false);
  });
});

describe('boolean flag getters (DOM checkbox-backed)', () => {
  it('isThoughtTreeEnabled reflects the #thoughtTreeToggle checkbox, false if absent', () => {
    expect(isThoughtTreeEnabled()).toBe(false);
    document.body.innerHTML = '<input type="checkbox" id="thoughtTreeToggle" checked>';
    expect(isThoughtTreeEnabled()).toBe(true);
  });
  it('isToolsEnabled reflects the #toolsToggle checkbox, false if absent', () => {
    expect(isToolsEnabled()).toBe(false);
    document.body.innerHTML = '<input type="checkbox" id="toolsToggle" checked>';
    expect(isToolsEnabled()).toBe(true);
  });
  it('isVoiceToVoiceMode reflects the #voiceToVoiceToggle checkbox, false if absent', () => {
    expect(isVoiceToVoiceMode()).toBe(false);
    document.body.innerHTML = '<input type="checkbox" id="voiceToVoiceToggle" checked>';
    expect(isVoiceToVoiceMode()).toBe(true);
  });
});

describe('browser-capability checks', () => {
  it('isWebAuthnSupported reflects window.PublicKeyCredential presence', () => {
    expect(isWebAuthnSupported()).toBe(false);
    window.PublicKeyCredential = function () {};
    expect(isWebAuthnSupported()).toBe(true);
    delete window.PublicKeyCredential;
  });
  it('isStandaloneDisplay reflects matchMedia standalone or navigator.standalone', () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn(() => ({ matches: true }));
    expect(isStandaloneDisplay()).toBe(true);
    window.matchMedia = vi.fn(() => ({ matches: false }));
    expect(isStandaloneDisplay()).toBe(false);
    window.matchMedia = original;
  });
});

describe('saveLocalModelSetting', () => {
  it('saves a trimmed non-empty input value to localStorage', () => {
    document.body.innerHTML = '<input id="localModelNameInput" value="  llama3  ">';
    saveLocalModelSetting();
    expect(localStorage.getItem('nexus_local_model_name')).toBe('llama3');
  });
  it('removes the key when the input is empty (matches its own else-branch)', () => {
    localStorage.setItem('nexus_local_model_name', 'old-value');
    document.body.innerHTML = '<input id="localModelNameInput" value="   ">';
    saveLocalModelSetting();
    expect(localStorage.getItem('nexus_local_model_name')).toBeNull();
  });
});

describe('graceful degradation when localStorage throws (real scenario: Safari private browsing, quota exceeded)', () => {
  it('every getter falls back to its documented default instead of throwing', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(getBackendUrl()).toBe('');
    expect(getChatModel()).toBe('anthropic');
    expect(getGatewayKey()).toBe('');
    expect(getLocalModelName()).toBe('');
    expect(getMarketContextCurrency()).toBe('USD');
    expect(getThemePreference()).toBe('auto');
    expect(getUILang()).toBe('ar');
    expect(getVoiceLang()).toBe('ar-SA');
    expect(getVoiceRate()).toBe(1);
    expect(getEnabledExtraProviders()).toEqual([]);
    expect(getLastKnownSyncVersion()).toBe(0);
    expect(getStoredWebAuthnCredentialId()).toBeNull();
    expect(isCloudSyncEnabled()).toBe(false);
    expect(isLongTermMemoryEnabled()).toBe(false);
    expect(isMarketContextEnabled()).toBe(false);
    spy.mockRestore();
  });
  it('getDeviceId falls back to a fixed placeholder rather than throwing', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(getDeviceId()).toBe('dev_unknown');
    spy.mockRestore();
  });
  it('setLastKnownSyncVersion swallows a write failure silently (never throws to its caller)', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(() => setLastKnownSyncVersion(5)).not.toThrow();
    spy.mockRestore();
  });
});
