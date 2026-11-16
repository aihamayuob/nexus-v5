/* ==========================================================================
   main.js — Neural Nexus AI Agents bootstrap / orchestration entry point

   Phase 2 (/nexus-modularize), protocol §11: "main.js يجب أن يصبح
   bootstrap/orchestration entry point، لا monolith جديداً" — this file's
   only job is to import extracted modules and bridge them into the global
   scope the not-yet-extracted remainder of the app still runs in. It
   contains no application logic of its own and never will.

   Boundaries bridged so far: #1 "security", #2 "storage", #3 "utilities",
   #4 "settings", plus the first slice of #5 "core" (encryptState/
   decryptState, which live in security.mjs) and its slice 4 (the registry-parameter
   snapshot/restore/reset functions in storage.mjs, bridged as window.PersistableStateCore).
   See PHASE2-MODULARIZE.md for the full roadmap of what's
   extracted vs. still pending, and ADR/003-phase2-storage-boundary.md for
   why PERSISTABLE_STATE itself is deliberately NOT among storage's
   exports yet.

   WHY THE WINDOW BRIDGE, AND WHY IT'S SAFE:
   The main HTML file's big classic <script> (not yet fully modularized —
   that is later boundaries' work) calls hundreds of functions as bare
   identifiers, relying on them all sharing one global scope. An ES module
   does NOT share that scope — its top-level bindings are private to the
   module. Explicitly assigning each extracted export onto `window` is
   what keeps every existing call site (both inside the classic script and
   any inline HTML onclick="..." attribute) working completely unchanged.

   Module scripts (this one) execute in "defer" timing: after the document
   is parsed, before DOMContentLoaded — regardless of where the <script
   type="module"> tag sits in the document. The classic monolith script
   executes synchronously, immediately, as the parser reaches it. This
   ordering is only safe because nothing in the monolith calls any
   extracted function at its own top level (only inside function bodies,
   which only ever run later — in response to events or DOMContentLoaded)
   — verified for every boundary before extraction; see
   PHASE2-MODULARIZE.md's "top-level execution-order safety" check for the
   exact method and result.
   ========================================================================== */

import { escapeHtml, jsStr, deriveKey, b64ToBuf, bufToB64, encryptState, decryptState, PromptInjectionGuard } from './modules/security.mjs';
import { localStore, ExecutionCheckpoint, ImageStore, MessageArchive, snapshotPersistableState, restorePersistableState, resetPersistableState } from './modules/storage.mjs';
import { evaluateMathExpression, chunkText, agentShortDesc, cosineSimilarity, parseOneSSEFrame, estimateQuestionComplexity, reEl, localTimeStringToUTCHourMinute, describeRecurrence, truncateText, wsUid } from './modules/utilities.mjs';
import { getBackendUrl, getChatModel, getDeviceId, getEnabledExtraProviders, getGatewayKey, setGatewayKey, purgeLegacyGatewayKey, getLastKnownSyncVersion, getLocalModelName, getMarketContextCurrency, getStoredWebAuthnCredentialId, getThemePreference, getUILang, getVoiceLang, getVoiceRate, isCloudSyncEnabled, isLongTermMemoryEnabled, isMarketContextEnabled, isThoughtTreeEnabled, isToolsEnabled, isVoiceToVoiceMode, isWebAuthnSupported, isStandaloneDisplay, setLastKnownSyncVersion, saveLocalModelSetting } from './modules/settings.mjs';
import { installGlobalStateAccessors } from './modules/state.mjs';

window.escapeHtml = escapeHtml;
window.jsStr = jsStr;
window.deriveKey = deriveKey;
window.b64ToBuf = b64ToBuf;
window.bufToB64 = bufToB64;
window.encryptState = encryptState;
window.decryptState = decryptState;
window.PromptInjectionGuard = PromptInjectionGuard;
window.localStore = localStore;
window.ExecutionCheckpoint = ExecutionCheckpoint;
window.ImageStore = ImageStore;
window.MessageArchive = MessageArchive;
// Core slice 4 / C1: namespaced ON PURPOSE. The plain names snapshotPersistableState /
// restorePersistableState / resetPersistableState stay as classic wrappers in the monolith (they pass
// PERSISTABLE_STATE, so every existing zero-registry call site is unchanged); assigning the module
// functions to those same window names would replace the wrappers. See CP-11.
window.PersistableStateCore = { snapshotPersistableState, restorePersistableState, resetPersistableState };
window.evaluateMathExpression = evaluateMathExpression;
window.chunkText = chunkText;
window.agentShortDesc = agentShortDesc;
window.cosineSimilarity = cosineSimilarity;
window.parseOneSSEFrame = parseOneSSEFrame;
window.estimateQuestionComplexity = estimateQuestionComplexity;
window.reEl = reEl;
window.localTimeStringToUTCHourMinute = localTimeStringToUTCHourMinute;
window.describeRecurrence = describeRecurrence;
window.truncateText = truncateText;
window.wsUid = wsUid;
window.getBackendUrl = getBackendUrl;
window.getChatModel = getChatModel;
window.getDeviceId = getDeviceId;
window.getEnabledExtraProviders = getEnabledExtraProviders;
window.getGatewayKey = getGatewayKey;
window.setGatewayKey = setGatewayKey;
/* Release V1 · B4: remove any pre-B4 persisted gateway key at boot (memory-only from now on). */
purgeLegacyGatewayKey();
window.getLastKnownSyncVersion = getLastKnownSyncVersion;
window.getLocalModelName = getLocalModelName;
window.getMarketContextCurrency = getMarketContextCurrency;
window.getStoredWebAuthnCredentialId = getStoredWebAuthnCredentialId;
window.getThemePreference = getThemePreference;
window.getUILang = getUILang;
window.getVoiceLang = getVoiceLang;
window.getVoiceRate = getVoiceRate;
window.isCloudSyncEnabled = isCloudSyncEnabled;
window.isLongTermMemoryEnabled = isLongTermMemoryEnabled;
window.isMarketContextEnabled = isMarketContextEnabled;
window.isThoughtTreeEnabled = isThoughtTreeEnabled;
window.isToolsEnabled = isToolsEnabled;
window.isVoiceToVoiceMode = isVoiceToVoiceMode;
window.isWebAuthnSupported = isWebAuthnSupported;
window.isStandaloneDisplay = isStandaloneDisplay;
window.setLastKnownSyncVersion = setLastKnownSyncVersion;
window.saveLocalModelSetting = saveLocalModelSetting;

// Core slice 10 (CP-18, ADR-005): `agentOrder` is owned by modules/state.mjs; this installs window.agentOrder (accessor)
// so the classic script's bare-name reads/writes keep working. Must stay BEFORE the startup calls below.
installGlobalStateAccessors(window);

/* Application startup — moved here from the end of the classic script
   (same 5 calls, same order) precisely because it must run AFTER the
   bridge assignments above. This module executes once, after the
   document has fully parsed (defer timing), which is functionally the
   same point the old top-level calls ran at (they were the last
   statements in a script placed right before </body>) — no meaningful
   timing change from a user's perspective, just a correct dependency
   order. */
window.applyTheme();
window.applyTranslations();
const bootInit = window.autoInitApp();
window.registerServiceWorker();
// Core slice 6 / I-1 (O2): updateOnlineStatus() runs only AFTER autoInitApp() has settled, so the boot-time
// offline activityLog entry is written after restorePersistableState() instead of being overwritten by it.
// `.finally` (not `.then`): it must still run if autoInitApp() rejects, and the rejection must stay unhandled
// (visible), exactly as before. The online/offline listeners stay registered at parse time and are untouched. See CP-13.
bootInit.finally(() => window.updateOnlineStatus());
