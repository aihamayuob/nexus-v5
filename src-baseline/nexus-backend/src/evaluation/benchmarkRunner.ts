import { runAllBenchmarks, type BenchmarkResult } from './benchmarkTasks.js';
import { getRepos } from '../persistence/repos.js';
import type { BenchmarkRunRecord } from '../persistence/repositories/benchmarkRunRepo.js';

export interface BenchmarkSummary {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  avgLatencyMs: number;
  byCategory: Record<string, { total: number; passed: number }>;
}

export interface RegressionFinding {
  severity: 'regression' | 'improvement' | 'new_failure' | 'fixed';
  name: string;
  message: string;
}

export interface RegressionReport {
  hasRegressions: boolean;
  findings: RegressionFinding[];
  currentPassRate: number;
  previousPassRate: number | null;
}

function summarize(results: BenchmarkResult[]): BenchmarkSummary {
  const byCategory: BenchmarkSummary['byCategory'] = {};
  for (const r of results) {
    byCategory[r.category] ??= { total: 0, passed: 0 };
    byCategory[r.category]!.total++;
    if (r.pass) byCategory[r.category]!.passed++;
  }
  const passed = results.filter((r) => r.pass).length;
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    passRate: results.length ? passed / results.length : 1,
    avgLatencyMs: results.length ? results.reduce((s, r) => s + r.latencyMs, 0) / results.length : 0,
    byCategory,
  };
}

/**
 * Runs the full benchmark suite, stores it as a release snapshot, and
 * compares against the immediately previous stored run — this is the
 * "compare Current Release vs Previous Release, detect regression before
 * delivery" requirement. A regression is any individual benchmark that
 * passed last time and fails now; the reverse (fixed) is reported too so
 * the comparison is honest in both directions, not just alarm-only.
 */
export async function runBenchmarkSuiteAndCompare(releaseLabel: string): Promise<{
  results: BenchmarkResult[];
  summary: BenchmarkSummary;
  regression: RegressionReport;
  runId: string;
}> {
  const results = await runAllBenchmarks();
  const summary = summarize(results);

  const previousRun = getRepos().benchmarkRuns.latest(); // "previous" relative to the NEW run we're about to save
  const saved = getRepos().benchmarkRuns.save(releaseLabel, results, summary);

  const regression = compareRuns(results, previousRun);

  return { results, summary, regression, runId: saved.id };
}

function compareRuns(currentResults: BenchmarkResult[], previousRun: BenchmarkRunRecord | null): RegressionReport {
  if (!previousRun) {
    return { hasRegressions: false, findings: [], currentPassRate: summarize(currentResults).passRate, previousPassRate: null };
  }
  const previousResults = previousRun.results as BenchmarkResult[];
  const previousByName = new Map(previousResults.map((r) => [r.name, r]));
  const findings: RegressionFinding[] = [];

  for (const current of currentResults) {
    const previous = previousByName.get(current.name);
    if (!previous) continue; // new benchmark, nothing to compare against yet
    if (previous.pass && !current.pass) {
      findings.push({ severity: 'regression', name: current.name, message: `كانت ناجحة، أصبحت فاشلة: ${current.details ?? ''}`.trim() });
    } else if (!previous.pass && current.pass) {
      findings.push({ severity: 'fixed', name: current.name, message: 'كانت فاشلة، أصبحت ناجحة.' });
    } else if (current.pass && previous.pass && current.latencyMs > previous.latencyMs * 2 && current.latencyMs > 100) {
      findings.push({
        severity: 'regression',
        name: current.name,
        message: `تدهور واضح بزمن الاستجابة: ${previous.latencyMs}ms إلى ${current.latencyMs}ms`,
      });
    }
  }

  const currentPassRate = summarize(currentResults).passRate;
  const previousSummary = previousRun.summary as BenchmarkSummary;
  const hasRegressions = findings.some((f) => f.severity === 'regression');

  return { hasRegressions, findings, currentPassRate, previousPassRate: previousSummary.passRate };
}

export { summarize };
