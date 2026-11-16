import { SseWriter } from '../streaming/sse.js';
import { getRepos } from '../persistence/repos.js';

interface LiveStream {
  writers: Set<SseWriter>;
  seq: number;
  done: boolean;
}

/**
 * One StreamRegistry entry per task. emit() ALWAYS persists to SQLite
 * first, then fans out to any currently-attached SseWriters — so a
 * client that reconnects mid-stream (GET .../resume/:taskId?afterId=N)
 * can replay everything it missed from disk, then get attached live for
 * anything still to come. This backs BOTH the legacy /api/chat resume
 * endpoint and /api/runtime/*'s new resume capability with one
 * implementation.
 */
class StreamRegistryImpl {
  private live = new Map<string, LiveStream>();

  private ensure(taskId: string): LiveStream {
    let s = this.live.get(taskId);
    if (!s) {
      const startSeq = getRepos().streamEvents.maxSeq(taskId);
      s = { writers: new Set(), seq: startSeq, done: false };
      this.live.set(taskId, s);
    }
    return s;
  }

  emit(taskId: string, event: string, data: unknown): number {
    const s = this.ensure(taskId);
    s.seq += 1;
    getRepos().streamEvents.append(taskId, s.seq, event, data);
    for (const w of s.writers) w.send(event, data, s.seq);
    return s.seq;
  }

  attach(taskId: string, writer: SseWriter) {
    const s = this.ensure(taskId);
    s.writers.add(writer);
  }

  detach(taskId: string, writer: SseWriter) {
    this.live.get(taskId)?.writers.delete(writer);
  }

  markDone(taskId: string) {
    const s = this.live.get(taskId);
    if (s) s.done = true;
  }

  /**
   * Phase 3 Slice 13 (Warden PAUSE/RESUME) — clears a previously-set
   * `done` flag so a MANUALLY RESUMED mission's SSE consumers correctly
   * see the stream as live again on the very next emit(), instead of
   * routes/v2/tasks.ts's `registry.isDone(taskId)` check (and the
   * equivalent checks in routes/legacy/chat.ts and runtime.ts) staying
   * permanently true from the pause. Deliberately does NOT touch `seq`
   * (so already-durable, already-delivered sequence numbers are never
   * reused or duplicated) or the durable event log in streamEvents — it
   * only affects in-memory liveness bookkeeping. A safe no-op for a
   * taskId with no prior entry: ensure() below creates a fresh one that
   * is already `done: false`. This concern is specific to a mission
   * being resumed WITHOUT a process restart — resumeInterruptedMissions()
   * (crash recovery) never needs this call, because a real process
   * restart wipes the whole in-memory `live` Map already.
   */
  reopen(taskId: string) {
    const s = this.ensure(taskId);
    s.done = false;
  }

  /** Replays everything after `afterSeq` from durable storage — used by resume handlers before attaching the writer for anything new. */
  replay(taskId: string, afterSeq: number, writer: SseWriter) {
    const events = getRepos().streamEvents.since(taskId, afterSeq);
    for (const e of events) writer.send(e.event, e.data, e.seq);
  }

  isDone(taskId: string): boolean {
    return this.live.get(taskId)?.done ?? false;
  }

  /** Housekeeping after a stream's consumers are all gone and it won't be resumed (task reached a terminal state and its response already fully delivered). */
  cleanup(taskId: string) {
    this.live.delete(taskId);
  }
}

let singleton: StreamRegistryImpl | null = null;
export function getStreamRegistry(): StreamRegistryImpl {
  if (!singleton) singleton = new StreamRegistryImpl();
  return singleton;
}

/** Test-only. */
export function resetStreamRegistryForTests() {
  singleton = new StreamRegistryImpl();
}
