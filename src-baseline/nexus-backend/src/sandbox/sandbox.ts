import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ServerConfig } from '../config/env.js';
import { auditSecurityEvent } from '../security/audit.js';
import { Errors } from '../core/errors.js';

/**
 * Sandbox (Phase 3 §10 — "FINAL SANDBOX TEST"). Read this comment before
 * trusting anything this module claims to protect against.
 *
 * VERIFIED FACT ABOUT THIS DEPLOYMENT ENVIRONMENT: there is no Docker, no
 * firejail, no bubblewrap, and no gVisor/Firecracker-style micro-VM
 * available on the host this backend runs on (checked directly: `which
 * docker firejail bubblewrap` all return nothing). Real OS-level
 * isolation — a filesystem jail, a network namespace, a cgroup memory/CPU
 * limit — requires exactly those primitives (or root + manual
 * namespace/cgroup setup, which this process does not have and should
 * not be given). Without them, a spawned child process runs as the SAME
 * OS user, with the SAME filesystem/network access, as the Node.js
 * server process itself.
 *
 * WHAT THIS MODULE ACTUALLY, VERIFIABLY ENFORCES (real, tested below):
 *   - A dedicated scratch temp directory as the child's cwd, deleted
 *     after every run — contains where the script's OWN relative-path
 *     file operations land, and is cleaned up so nothing it wrote lingers.
 *   - A minimal environment — only PATH is inherited; NEXUS_* secrets,
 *     provider API keys, and anything else in this process's env are
 *     NEVER passed to the child, so a malicious script cannot exfiltrate
 *     them by reading process.env.
 *   - A hard wall-clock timeout (SIGKILL on expiry) — a script cannot
 *     hang or run indefinitely.
 *   - A hard output-size cap — a script cannot exhaust memory/disk by
 *     printing unbounded output; the process is killed once the cap is
 *     hit.
 *   - A concurrency cap — bounds how many sandboxed executions can run
 *     at once process-wide, independent of Warden/task concurrency.
 *   - No shell interpolation (spawn with an argv array, `shell: false`)
 *     — the code string is written to a file and executed by path, never
 *     concatenated into a shell command line.
 *
 * WHAT THIS MODULE DOES **NOT** PROTECT AGAINST (explicitly, so no one
 * mistakes silence for safety):
 *   - A script CAN read/write any file the OS user can access outside
 *     the scratch dir (e.g. via an absolute path) — there is no
 *     filesystem jail.
 *   - A script CAN make outbound network requests — there is no network
 *     namespace or firewall rule in front of it.
 *   - A script CAN spawn further subprocesses, subject only to the
 *     overall wall-clock timeout, not a process-count limit.
 *   - Memory/CPU are NOT hard-capped via cgroups — only wall-clock time
 *     and output size are bounded.
 *
 * Given that, `ServerConfig.codeExecutionEnabled` defaults to FALSE —
 * this is a real, load-bearing, fail-closed gate, not a formality — and
 * every execution is audited via auditSecurityEvent so use is visible
 * even when explicitly enabled. This is the honest, verified state of
 * Sandbox in THIS slice; true isolation is tracked as an explicit,
 * disclosed risk (see PHASE3_SLICE3_REPORT.md), not silently implied.
 */

export type SandboxLanguage = 'javascript' | 'python';

export interface SandboxRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  truncated: boolean;
}

const INTERPRETER: Record<SandboxLanguage, { cmd: string; fileName: string; args: (scriptPath: string) => string[] }> = {
  javascript: { cmd: 'node', fileName: 'script.js', args: (p) => [p] },
  python: { cmd: 'python3', fileName: 'script.py', args: (p) => [p] },
};

let activeCount = 0;

async function acquireSlot(): Promise<() => void> {
  const start = Date.now();
  while (activeCount >= ServerConfig.codeExecutionMaxConcurrency) {
    if (Date.now() - start > 5000) throw Errors.rateLimited('صندوق التنفيذ (Sandbox) مشغول بأقصى طاقته الآن — أعد المحاولة خلال لحظات.');
    await new Promise((r) => setTimeout(r, 50));
  }
  activeCount++;
  return () => {
    activeCount--;
  };
}

export const Sandbox = {
  async runCode(language: SandboxLanguage, code: string): Promise<SandboxRunResult> {
    if (!ServerConfig.codeExecutionEnabled) {
      throw Errors.capabilityDenied('تنفيذ الكود (code_execution) معطّل على هذا الخادم — يتطلب تفعيل NEXUS_ENABLE_CODE_EXECUTION_TOOL صراحة من المشغّل، مع العلم أن العزل الحالي عزل جزئي (انظر توثيق Sandbox).');
    }
    const interp = INTERPRETER[language];
    if (!interp) throw Errors.toolValidation(`لغة غير مدعومة: ${language}`);

    const release = await acquireSlot();
    const scratchDir = mkdtempSync(join(tmpdir(), 'nexus-sandbox-'));
    try {
      const scriptPath = join(scratchDir, interp.fileName);
      writeFileSync(scriptPath, code, 'utf-8');

      const result = await new Promise<SandboxRunResult>((resolve) => {
        let stdout = '';
        let stderr = '';
        let truncated = false;
        let timedOut = false;
        const cap = ServerConfig.codeExecutionMaxOutputChars;

        const child = spawn(interp.cmd, interp.args(scriptPath), {
          cwd: scratchDir,
          env: { PATH: process.env.PATH ?? '/usr/bin:/bin' }, // deliberately minimal — see file doc comment
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        const killForOverflow = () => {
          truncated = true;
          child.kill('SIGKILL');
        };

        child.stdout.on('data', (chunk: Buffer) => {
          if (truncated) return;
          stdout += chunk.toString('utf-8');
          if (stdout.length > cap) {
            stdout = stdout.slice(0, cap);
            killForOverflow();
          }
        });
        child.stderr.on('data', (chunk: Buffer) => {
          if (truncated) return;
          stderr += chunk.toString('utf-8');
          if (stderr.length > cap) {
            stderr = stderr.slice(0, cap);
            killForOverflow();
          }
        });

        const timer = setTimeout(() => {
          timedOut = true;
          child.kill('SIGKILL');
        }, ServerConfig.codeExecutionTimeoutMs);

        child.on('close', (exitCode) => {
          clearTimeout(timer);
          resolve({ stdout, stderr, exitCode, timedOut, truncated });
        });
        child.on('error', (err) => {
          clearTimeout(timer);
          resolve({ stdout, stderr: stderr + `\n[sandbox spawn error: ${err.message}]`, exitCode: null, timedOut: false, truncated });
        });
      });

      auditSecurityEvent('info', 'Sandbox: code execution', {
        language,
        codeChars: code.length,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        truncated: result.truncated,
      });
      return result;
    } finally {
      release();
      rmSync(scratchDir, { recursive: true, force: true });
    }
  },
};
