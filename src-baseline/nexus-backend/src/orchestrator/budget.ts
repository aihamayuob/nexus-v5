import { ServerConfig } from '../config/env.js';
import { Errors } from '../core/errors.js';
import { getRepos } from '../persistence/repos.js';
import { auditSecurityEvent } from '../security/audit.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export const BudgetGuard = {
  /** Throws Errors.budgetExceeded() if the rolling-24h spend already exceeds the configured daily cap. A cap of 0 means the guard is disabled. */
  assertWithinBudget(): void {
    if (ServerConfig.dailyBudgetUsd <= 0) return;
    const spent = getRepos().observability.costInWindow(DAY_MS);
    if (spent >= ServerConfig.dailyBudgetUsd) {
      auditSecurityEvent('critical', 'Daily budget exceeded — request blocked', {
        spentUsd: spent,
        capUsd: ServerConfig.dailyBudgetUsd,
      });
      throw Errors.budgetExceeded(
        `تم تجاوز الحد اليومي للتكلفة (${ServerConfig.dailyBudgetUsd}$) — الإنفاق الحالي ضمن آخر 24 ساعة: ${spent.toFixed(4)}$.`
      );
    }
  },

  status() {
    const spent = ServerConfig.dailyBudgetUsd > 0 ? getRepos().observability.costInWindow(DAY_MS) : 0;
    return { enabled: ServerConfig.dailyBudgetUsd > 0, capUsd: ServerConfig.dailyBudgetUsd, spentUsd: spent };
  },
};

/**
 * Rough per-provider cost estimate (USD) from token counts, used ONLY to
 * feed the budget guard and observability — never shown to the model,
 * never treated as a billing-grade figure. Rates are conservative
 * approximations and overridable via env if a deployment wants tighter
 * accuracy; being slightly wrong here fails safe (guard trips a bit early
 * or late), unlike a model-name bug which silently mis-routes requests.
 */
const RATE_PER_1K_TOKENS_USD: Record<string, { input: number; output: number }> = {
  anthropic: { input: 0.003, output: 0.015 },
  openai: { input: 0.0025, output: 0.01 },
  deepseek: { input: 0.00027, output: 0.0011 },
  gemini: { input: 0.00015, output: 0.0006 },
  ollama: { input: 0, output: 0 },
  lmstudio: { input: 0, output: 0 },
};

export function estimateCostUsd(provider: string, inputTokens: number, outputTokens: number): number {
  const rate = RATE_PER_1K_TOKENS_USD[provider] ?? { input: 0.002, output: 0.008 };
  return (inputTokens / 1000) * rate.input + (outputTokens / 1000) * rate.output;
}
