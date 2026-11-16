# Release V1 · B4 — tests superseded by an owner-directed contract change (disclosed, not silent)

Directive item 4: "Do NOT store the gateway key in localStorage or sessionStorage; use memory only."

| Test | File | Old contract | What happened | Replacement |
|---|---|---|---|---|
| `getGatewayKey: default "", real value "secret-key"` (one row of the "simple localStorage getters" table) | `frontend/modules/settings.test.mjs` | `getGatewayKey()` returns `localStorage['nexus_gateway_key']` | Failed on the B4 tree (`b4-fe-vitest-POST-before-supersede.log`: 1 failed / 186 passed) — a real, intended behavior change, not a defect. The table row was removed and replaced by a comment pointing here. No other assertion in the file was touched; the "graceful degradation" assertion `expect(getGatewayKey()).toBe('')` still passes unchanged. | `frontend/modules/gatewayKey.test.mjs` (9 tests: memory-only, trim/clear, nothing written to either storage — spied and scanned, no adoption of a legacy value, never touches storage, purge safe/limited) + E2E `e2e/release-v1-b4-key-and-csp-flows.mjs` (real browser) |

Evidence the new tests discriminate: `b4-fe-unit-PRE.log` — on the pre-B4 tree all 9 new tests fail (`setGatewayKey` does not exist / key persisted).

Behavior change visible to users: the gateway key must be re-entered after every page reload (by design). A key persisted by an earlier version is deleted at boot and NOT adopted.
