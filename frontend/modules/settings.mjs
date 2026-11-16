/* ==========================================================================
   modules/settings.mjs — Neural Nexus AI Agents

   Phase 2 (/nexus-modularize), extraction boundary #4: "settings" (a
   coherent sub-slice of the protocol's "UI" boundary — see
   PHASE2-MODULARIZE.md's boundary-3 section for why "utilities" was
   split the same way: mixing genuinely different categories into one
   module blurs what each boundary means, more than it saves).
   Behavior-preserving MOVE — every body below is byte-identical to its
   prior inline definition (diff-verified, see PHASE2-MODULARIZE.md).

   22 simple getters/setters for persisted or DOM-reflected settings
   (backend URL, gateway key, theme, language, voice, sync version,
   toggle checkboxes for tools/thought-tree/voice-mode, etc.). All
   confirmed zero-dependency on other top-level functions/state before
   extraction. One (saveLocalModelSetting) is called from an inline HTML
   handler; three (isCloudSyncEnabled, getThemePreference, getUILang) are
   called from the app-startup sequence main.js already orchestrates
   (see ADR/002) — both cases handled by the same window-bridge pattern
   used since boundary #1, with this module's bridge assignments placed
   before the startup-sequence call in main.js.

   Deliberately excludes the remaining "UI" candidates (closeModal,
   showToast, streaming-bubble helpers, side-menu/plus-menu toggles) —
   those are DOM-chrome interactions, a different concern from reading/
   writing a setting, and are left for a later continuation of the UI
   boundary.
   ========================================================================== */

export function getBackendUrl(){
  try{ return localStorage.getItem('nexus_backend_url') || ''; }
  catch(e){ return ''; }
}
export function getChatModel(){
  try{ return localStorage.getItem('nexus_chat_model') || 'anthropic'; }
  catch(e){ return 'anthropic'; }
}
export function getDeviceId(){
  try{
    let id = localStorage.getItem('nexus_device_id');
    if(!id){ id = 'dev_' + crypto.randomUUID(); localStorage.setItem('nexus_device_id', id); }
    return id;
  }catch(e){ return 'dev_unknown'; }
}
export function getEnabledExtraProviders(){
  try{ return JSON.parse(localStorage.getItem('nexus_providers') || '[]'); }
  catch(e){ return []; }
}
/* Release V1 · B4: the backend gateway key is held in MEMORY ONLY (never localStorage/sessionStorage/IndexedDB/cache).
   It is lost on reload by design; the user re-enters it. Never log it or put it in an exported/synced payload. */
let _gatewayKey = '';
export function getGatewayKey(){
  return _gatewayKey;
}
export function setGatewayKey(key){
  _gatewayKey = (typeof key === 'string') ? key.trim() : '';
}
/* One-time cleanup of the pre-B4 persisted key (deliberately NOT adopted into memory). */
export function purgeLegacyGatewayKey(){
  try{ localStorage.removeItem('nexus_gateway_key'); }catch(e){}
  try{ sessionStorage.removeItem('nexus_gateway_key'); }catch(e){}
}
export function getLastKnownSyncVersion(){
  try{ return parseInt(localStorage.getItem('nexus_sync_version')||'0', 10); }catch(e){ return 0; }
}
export function getLocalModelName(){
  try{ return localStorage.getItem('nexus_local_model_name') || ''; }
  catch(e){ return ''; }
}
export function getMarketContextCurrency(){
  try{ return localStorage.getItem('nexus_market_context_currency') || 'USD'; }
  catch(e){ return 'USD'; }
}
export function getStoredWebAuthnCredentialId(){
  try{ return localStorage.getItem('nexus_webauthn_credential_id'); }
  catch(e){ return null; }
}
export function getThemePreference(){
  try{ return localStorage.getItem('nexus_theme') || 'auto'; }
  catch(e){ return 'auto'; }
}
export function getUILang(){
  try{ return localStorage.getItem('nexus_ui_lang') || 'ar'; }
  catch(e){ return 'ar'; }
}
export function getVoiceLang(){
  try{ return localStorage.getItem('nexus_voice_lang') || 'ar-SA'; }
  catch(e){ return 'ar-SA'; }
}
export function getVoiceRate(){
  try{ return parseFloat(localStorage.getItem('nexus_voice_rate')) || 1; }
  catch(e){ return 1; }
}
export function isCloudSyncEnabled(){
  try{ return localStorage.getItem('nexus_sync_enabled') === '1'; }catch(e){ return false; }
}
export function isLongTermMemoryEnabled(){
  try{ return localStorage.getItem('nexus_ltm_enabled') === '1'; }catch(e){ return false; }
}
export function isMarketContextEnabled(){
  try{ return localStorage.getItem('nexus_market_context_enabled') === 'true'; }
  catch(e){ return false; }
}
export function isThoughtTreeEnabled(){
  return !!document.getElementById('thoughtTreeToggle')?.checked;
}
export function isToolsEnabled(){
  const el = document.getElementById('toolsToggle');
  return el ? el.checked : false;
}
export function isVoiceToVoiceMode(){
  const el = document.getElementById('voiceToVoiceToggle');
  return el ? el.checked : false;
}
export function isWebAuthnSupported(){
  return !!window.PublicKeyCredential;
}
export function isStandaloneDisplay(){
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
export function setLastKnownSyncVersion(v){
  try{ localStorage.setItem('nexus_sync_version', String(v)); }catch(e){}
}
export function saveLocalModelSetting(){
  const val = document.getElementById('localModelNameInput').value.trim();
  try{
    if(val) localStorage.setItem('nexus_local_model_name', val);
    else localStorage.removeItem('nexus_local_model_name');
  }catch(e){ console.error(e); }
}
