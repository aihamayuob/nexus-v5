import type { DagPlan, DagTaskDef, DagNodeStatus } from './dagTypes.js';

export interface NodeRunContext {
  goal: string;
  upstreamOutputs: Record<string, string>;
}

export interface ReflectionResult {
  verdict: 'ok' | 'revise';
  critique?: string;
}

export interface DagExecutorOptions {
  taskId: string;
  plan: DagPlan;
  emit: (event: string, data: Record<string, unknown>) => void;
  runNode: (node: DagTaskDef, ctx: NodeRunContext, signal?: AbortSignal) => Promise<string>;
  reflect?: (node: DagTaskDef, draftOutput: string, signal?: AbortSignal) => Promise<ReflectionResult>;
  reviseNode?: (node: DagTaskDef, ctx: NodeRunContext, critique: string, signal?: AbortSignal) => Promise<string>;
  synthesize: (goal: string, results: Record<string, string>, onToken: (t: string) => void, signal?: AbortSignal) => Promise<string>;
  persistNode: (node: {
    nodeId: string;
    description: string;
    dependsOn: string[];
    status: DagNodeStatus;
    attempt: number;
    output: string | null;
    errorMessage: string | null;
  }) => void;
  maxConcurrency?: number;
  maxRetries?: number;
  /** Per-node timeout — NEXUS Phase 2 §A ("timeout" as a first-class runtime capability). Optional and unset by default, so every existing caller keeps its current no-timeout behavior unchanged. A timeout counts as a retryable failure, going through the SAME bounded maxRetries/backoff path as any other error — it never bypasses the retry limit. */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Seed state for resuming an interrupted plan — nodes already 'done' are not re-run; their persisted output feeds downstream nodes and synthesis directly. */
  resumeFrom?: Array<{ nodeId: string; status: DagNodeStatus; output: string | null }>;
}

interface NodeState {
  status: DagNodeStatus;
  attempt: number;
  output: string | null;
  error: string | null;
}

export interface DagExecutionResult {
  finalOutput: string | null;
  allFailed: boolean;
  nodeStates: Record<string, NodeState>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Races a single node's execution against a timeout — timing out throws a plain Error, which runOneNode's existing catch block already treats as a retryable failure like any provider error, so timeoutMs never needs its own separate retry/backoff logic. */
async function runNodeWithTimeout(
  runNode: DagExecutorOptions['runNode'],
  node: DagTaskDef,
  ctx: NodeRunContext,
  signal: AbortSignal | undefined,
  timeoutMs: number
): Promise<string> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<string>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`انتهت مهلة تنفيذ المهمة الفرعية "${node.id}" (${timeoutMs}ms).`)), timeoutMs);
  });
  try {
    return await Promise.race([runNode(node, ctx, signal), timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

export async function executeDag(opts: DagExecutorOptions): Promise<DagExecutionResult> {
  const maxConcurrency = opts.maxConcurrency ?? 4;
  const maxRetries = opts.maxRetries ?? 1;
  const nodesById = new Map(opts.plan.tasks.map((t) => [t.id, t]));
  const states = new Map<string, NodeState>();

  for (const t of opts.plan.tasks) states.set(t.id, { status: 'pending', attempt: 0, output: null, error: null });
  for (const seed of opts.resumeFrom ?? []) {
    if (states.has(seed.nodeId)) states.set(seed.nodeId, { status: seed.status, attempt: 0, output: seed.output, error: null });
  }

  function persist(id: string) {
    const node = nodesById.get(id)!;
    const s = states.get(id)!;
    opts.persistNode({
      nodeId: id,
      description: node.description,
      dependsOn: node.dependsOn,
      status: s.status,
      attempt: s.attempt,
      output: s.output,
      errorMessage: s.error,
    });
  }

  function depsSatisfied(node: DagTaskDef): boolean {
    return node.dependsOn.every((depId) => states.get(depId)?.status === 'done');
  }
  function depsBlocked(node: DagTaskDef): boolean {
    return node.dependsOn.some((depId) => {
      const depStatus = states.get(depId)?.status;
      return depStatus === 'failed' || depStatus === 'skipped';
    });
  }

  async function runOneNode(node: DagTaskDef): Promise<void> {
    const s = states.get(node.id)!;
    s.status = 'running';
    persist(node.id);
    opts.emit('task_start', { taskId: node.id });

    const upstreamOutputs: Record<string, string> = {};
    for (const depId of node.dependsOn) upstreamOutputs[depId] = states.get(depId)?.output ?? '';
    const ctx: NodeRunContext = { goal: opts.plan.goal, upstreamOutputs };

    let lastError: unknown = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      s.attempt = attempt + 1;
      try {
        let output = opts.timeoutMs ? await runNodeWithTimeout(opts.runNode, node, ctx, opts.signal, opts.timeoutMs) : await opts.runNode(node, ctx, opts.signal);

        if (opts.reflect) {
          const reflection = await opts.reflect(node, output, opts.signal);
          if (reflection.verdict === 'revise' && reflection.critique && opts.reviseNode) {
            opts.emit('task_reflection', { taskId: node.id, verdict: 'revise', critique: reflection.critique });
            output = await opts.reviseNode(node, ctx, reflection.critique, opts.signal);
          }
        }

        s.status = 'done';
        s.output = output;
        persist(node.id);
        opts.emit('task_done', { taskId: node.id, output });
        return;
      } catch (e) {
        lastError = e;
        if (e instanceof DOMException && e.name === 'AbortError') throw e;
        if (attempt < maxRetries) {
          opts.emit('task_retry', { taskId: node.id, reason: (e as Error).message, attempt: attempt + 1 });
          await sleep(400 * Math.pow(2, attempt));
        }
      }
    }

    s.status = 'failed';
    s.error = (lastError as Error)?.message ?? 'فشل غير معروف';
    persist(node.id);
    opts.emit('task_failed', { taskId: node.id, error: s.error });
  }

  const running = new Map<string, Promise<void>>();

  outer: while (true) {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const pending = [...states.entries()].filter(([, s]) => s.status === 'pending');
    if (pending.length === 0 && running.size === 0) break;

    // Cascade-skip anything blocked by a failed/skipped dependency —
    // repeated each loop iteration so multi-level cascades fully resolve.
    let skippedSomething = true;
    while (skippedSomething) {
      skippedSomething = false;
      for (const [id, s] of states) {
        if (s.status !== 'pending') continue;
        const node = nodesById.get(id)!;
        if (depsBlocked(node)) {
          s.status = 'skipped';
          s.error = 'تم تخطيها بسبب فشل مهمة يعتمد عليها.';
          persist(id);
          opts.emit('task_skipped', { taskId: id, reason: s.error });
          skippedSomething = true;
        }
      }
    }

    const ready = [...states.entries()].filter(
      ([id, s]) => s.status === 'pending' && depsSatisfied(nodesById.get(id)!) && !running.has(id)
    );

    if (ready.length === 0 && running.size === 0) {
      // Nothing ready, nothing in flight, but pending nodes remain -> a
      // genuine cycle (or a dependency on a non-existent id). Fail them
      // explicitly rather than spinning forever.
      for (const [id, s] of states) {
        if (s.status === 'pending') {
          s.status = 'failed';
          s.error = 'تعذّر تنفيذها — اعتمادية دائرية أو غير صالحة.';
          persist(id);
          opts.emit('task_failed', { taskId: id, error: s.error });
        }
      }
      break outer;
    }

    const slots = Math.max(0, maxConcurrency - running.size);
    for (const [id] of ready.slice(0, slots)) {
      const node = nodesById.get(id)!;
      const p = runOneNode(node).finally(() => running.delete(id));
      running.set(id, p);
    }

    if (running.size > 0) {
      await Promise.race(running.values());
    }
  }

  const doneResults: Record<string, string> = {};
  let anyDone = false;
  for (const [id, s] of states) {
    if (s.status === 'done' && s.output != null) {
      doneResults[id] = s.output;
      anyDone = true;
    }
  }

  if (!anyDone) {
    return { finalOutput: null, allFailed: true, nodeStates: Object.fromEntries(states) };
  }

  const finalOutput = await opts.synthesize(
    opts.plan.goal,
    doneResults,
    (text) => opts.emit('synthesis_token', { text }),
    opts.signal
  );
  return { finalOutput, allFailed: false, nodeStates: Object.fromEntries(states) };
}
