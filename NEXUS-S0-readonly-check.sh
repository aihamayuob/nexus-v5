#!/usr/bin/env bash
# NEXUS S0 — فحص قراءة فقط لمستودعك الحي. شغّله من جذر المستودع:
#   bash NEXUS-S0-readonly-check.sh [FRONTEND_DIR] [BACKEND_DIR] > ~/s0-output.txt 2>&1
# (وجّه الناتج لملف خارج المستودع). الافتراضي: frontend  و  src-baseline/nexus-backend
# لا يغيّر شيئًا: git rev-parse/status(--no-optional-locks)/log + sha256sum + ls فقط.
# لا reset ولا checkout ولا clean ولا كتابة داخل المستودع.
FE="${1:-frontend}"; BE="${2:-src-baseline/nexus-backend}"
echo "### S0 $(date -u +%FT%TZ)  cwd=$(pwd)"
echo "### ROOT-LS"; ls -1 | head -40
echo "### GIT"
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "toplevel=$(git rev-parse --show-toplevel)"
  echo "branch=$(git rev-parse --abbrev-ref HEAD)"
  echo "HEAD=$(git rev-parse HEAD)"
  echo "--- status (--short, أول 60 سطرًا)"; git --no-optional-locks status --short | head -60
  echo "status-lines=$(git --no-optional-locks status --short | wc -l)"
  echo "--- log -15"; git log --oneline -15
  echo "stash-entries=$(git stash list | wc -l)"
else
  echo "NOT-A-GIT-WORKTREE (الفرع/HEAD/status: دليل غير متاح)"
fi
cmp_one() { # label path expected [alt_label alt_hash]
  local label="$1" path="$2" exp="$3" alt="${4:-}" alth="${5:-}" got
  if [ ! -f "$path" ]; then printf "%-14s MISSING        %s\n" "$label" "$path"; return; fi
  got=$(sha256sum "$path" | cut -d' ' -f1)
  if [ "$got" = "$exp" ]; then printf "%-14s MATCH          %s\n" "$label" "$path"
  elif [ -n "$alth" ] && [ "$got" = "$alth" ]; then printf "%-14s MATCH-%s %s\n" "$label" "$alt" "$path"
  else printf "%-14s DIFF           %s  got=%s\n" "$label" "$path" "$got"; fi
}
echo "### FRONTEND (المتوقع: لقطة التسليم؛ لا تغيّره الرقع)"
cmp_one FE "$FE/neural_nexus_ai_agents-4-3-5-3.html" 0a017c03ba31423d2fbc0f01450febdafa27cf39a3262446d5f7d855f28b836e
cmp_one FE "$FE/main.js" 28cf9b8e78d8d3674bec4cfe71fbf24ff024902b7643a4abc982636ec4b5d936
cmp_one FE "$FE/sw.js" 6405116898510254b2ecaae2fcf45fe92b29f5a85081e1ea2674b417007b1901
cmp_one FE "$FE/modules/security.mjs" b70ffcf2959973647da2147cf178c78f14c97ace6c9f0ea853b1cec15856869d
cmp_one FE "$FE/modules/settings.mjs" 61bebf91ee8421c5880456ffaae3ff99d8672f12479f913a7e40ba9059dbb677
cmp_one FE "$FE/modules/state.mjs" 2eb6668d64834c57f70ceb2134def87ec76d94f45075d08cae4e45bbb992c2fc
cmp_one FE "$FE/modules/storage.mjs" a9f711e1b125d34cc7457e6c2c668af671c097bfdf5367dc415be68034faacbe
cmp_one FE "$FE/modules/utilities.mjs" 41a73683381fd7d4f8a23c2fc4925ab38188a4962e415737fdc30ef73e735ddf
echo "### BACKEND (المتوقع: حالة ما قبل VEL المُعاد بناؤها؛ البديل FINAL = بعد G8.2)"
cmp_one BE "$BE/src/config/env.ts" adf22db22b94a1c039e4067aa1acf97f8c3b98c5864f0dc9eddfb28e8dcce8ae FINAL 642da0dab166831fdb3755937573ef289267a5b858028bd822ce5f914ac7894b
cmp_one BE "$BE/src/gateway/server.ts" 6e2b908595f74bec227abfb0e837e5ead934437dbdb702b060542bec0d019629 FINAL 556a8d98eca21f976b111e955da24fcf2278d61028656b7098894cdaa6552505
cmp_one BE "$BE/src/index.ts" 5f686fc2a96e5c161f72a948aa1796f4fe78becde7c617fac6079438f1655b94 FINAL f5a91a28a081a2d8dbb3c8af2b1f05804c1f63667cffad8e930dc5430564937c
cmp_one BE "$BE/src/orchestrator/chatService.ts" fde3fc32974485b29a26e878ac1eb4915d2d92a61431e7e6f43eeed6a23349e5 FINAL 4c1a3023cef5cb5deb522609ff88d4c5640800a9fb9456f364abe6ae45a84bad
cmp_one BE "$BE/src/persistence/repos.ts" 4ba7bc091fbffc52f9ee4555b84113ae08e8238a36ce4ad59dcf7b0aafe962ba FINAL 831150eb31ad2652329b2242be4315c79fb78516c02598e01fdb0cb05c70c49c
cmp_one BE "$BE/src/tools/pipeline.ts" 54ac1f42fd6adcc515140791c903f8ddccf38642a87171dc0087736ab9df1faa FINAL b3c6a671d3fcc841c5128c65b48b2102d111a0262a5efa514d5d95a96bc8bc0b
cmp_one BE "$BE/src/tools/registry.ts" 37d091c31734f74a57b74ab2d7515247e4b932bcf63f38679288c0b956b503f9 FINAL 9b73a30f30400e53fa52b67665e533a526efc3684fc8200b438658471d8ea96d
cmp_one BE "$BE/src/tools/bootstrap.ts" 249445e97fad1cc864c3f2efd425f642d5f4d2a1bca0a5d93203f9eff2096754 FINAL 52e10c0c4bcd9b21d15610a7107a7740e25a1dbb66a94ae603b5a249682a6948
cmp_one BE "$BE/src/tools/builtin/calculateTool.ts" aed695e7a1f62544e29b30a90368ea653e4ce8f23c8b6eab07cf0e26e1faba36 FINAL bfaf7348d1f473021de683e3a9e79572890666dcb4a81171108f295171091097
cmp_one BE "$BE/src/tools/builtin/codeExecutionTool.ts" 2af4dd84d4ff1c06dcbd3d5a3565f748bf9596e4d6310adc80b89c55f4dda4ab FINAL dfb8166ceb42df3fda412af0ef97f60216468cc68ab9e6cafd2d5692ac9a4118
cmp_one BE "$BE/src/tools/builtin/webFetchTool.ts" 61731546aeeb3f97e297d68d7a38062ef528513b638066485516298279acd080 FINAL 2b7f8f7a8ac94bce1e5a3600a39a94281101c7321f05d510b8cd459ca86f7c2e
cmp_one BE "$BE/src/agents/agentRegistry.ts" 2017a9d6478b5e1597051f24bcf93cca51f73bc5f67f10b6264eaf673ef83f7a FINAL a832c7285cdcf477805376bef4f57a2f614829fc143b92f64b229dd876e2c409
cmp_one BE "$BE/test/evidenceIntegrity.test.ts" 6f926164379b0e4400489d6e4ed9b8bc538aae7ce4739f090408346690eaea6b FINAL a388caef905afa6f7606d1eaa52db1e4cf84f704e880d926828c359fd450ec9c
cmp_one BE "$BE/test/agentToolLoop.test.ts" c864ad534d0c72ad82a55cada373850014a46996ab095c9c3f6944efd33ff84e FINAL 4d8168fa83277a842b4407c1c33f1df0c03df646e28c17ee52c31b5516bcf6fe
cmp_one BE "$BE/src/security/cloudEgressGuard.ts" 24fe44413e7f802931de6e3bfbd8ce8e9d79d81c64c32890b9b983fac7bbd904 FINAL 24fe44413e7f802931de6e3bfbd8ce8e9d79d81c64c32890b9b983fac7bbd904
cmp_one BE "$BE/src/providers/modelRouter.ts" 2c8f9ea1669409e8267e99045a2af21341990e4008a66b2491f482293faf97eb FINAL 2c8f9ea1669409e8267e99045a2af21341990e4008a66b2491f482293faf97eb
echo "### MIGRATIONS (آخر 3؛ المتوقع قبل VEL: ...016_claim_evaluation_integrity_reason.sql)"; ls -1 "$BE/src/persistence/migrations" 2>/dev/null | tail -3 || echo "غير متاح"
echo "### GAP tests موجودة؟"; ls -1 "$BE/test" 2>/dev/null | grep -iE 'cloudEgress|privateRoutingEgress' || echo "لا شيء/غير متاح"
echo "### GAP-1/1B: مواقع استعمال الحارس في src (المتوقع: verifier, evaluationEngine, agentGenome, freshnessEngine, cloudEgressGuard)"; grep -rlE "checkCloudEgress|assertCloudEgressAllowed" "$BE/src" 2>/dev/null || echo "لا شيء/غير متاح"
echo "### VEL/G8 آثار (إن وُجدت فبعض الرقع مطبّقة)"; ls -1 "$BE/src/tools" 2>/dev/null | grep -E 'effect|verifiedExecution' || echo "لا آثار VEL في src/tools"
echo "### END"
