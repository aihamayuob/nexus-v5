import { getDb } from './persistence/db.js';
import { bootstrapTools } from './tools/bootstrap.js';
import { resumeInterruptedPlans } from './orchestrator/taskManager.js';
import { resumeInterruptedMissions } from './orchestrator/missionRunner.js';
import { resumeInterruptedCouncilSessions } from './council/councilRunner.js';
import { recoverInFlightReceipts } from './tools/verifiedExecution.js';
import { startServer } from './gateway/server.js';
import { startMqttBroker, stopMqttBroker } from './iot/mqttBroker.js';
import { ServerConfig } from './config/env.js';
import { startRetentionSweeper, runRetentionSweep } from './observability/retention.js';
import { startSchedulerLoop } from './scheduler/schedulerRunner.js';
import { logger } from './core/logger.js';
import { enforceDeployment } from './config/deploymentGuard.js';

async function main() {
  // Release V1 · B4: refuse an unprotected network bind BEFORE touching the DB or opening any listener.
  const deployment = enforceDeployment();
  for (const w of deployment.warnings) logger.warn('Deployment notice', { warning: w });
  const bootTime = Date.now();
  getDb(); // runs migrations
  bootstrapTools();
  const server = startServer();

  // Real durable-execution resume — not just detecting that something was
  // interrupted, but actually picking plans back up from their last
  // completed DAG node. Runs after the server starts listening so health
  // checks succeed immediately even while resume work is still catching up.
  resumeInterruptedPlans().catch((e) => logger.error('resumeInterruptedPlans failed at startup', { message: (e as Error).message }));
  resumeInterruptedMissions().catch((e) => logger.error('resumeInterruptedMissions failed at startup', { message: (e as Error).message }));
  resumeInterruptedCouncilSessions().catch((e) => logger.error('resumeInterruptedCouncilSessions failed at startup', { message: (e as Error).message }));

  // NEXUS VEL: any effectful action still IN_FLIGHT from before this boot lost its owner. Mark it OUTCOME_UNKNOWN and reconcile from the target state
  // (read-only — nothing is re-dispatched). A no-op when no effectful tool has ever run.
  recoverInFlightReceipts(bootTime).catch((e) => logger.error('recoverInFlightReceipts failed at startup', { message: (e as Error).message }));

  // Bounds unlimited growth of operational tables over a long-running
  // process (see observability/retention.ts) — one sweep at startup, then
  // hourly.
  runRetentionSweep();
  const retentionTimer = startRetentionSweeper();

  // Real execution loop for /api/schedules (previously CRUD-only — see
  // scheduler/schedulerRunner.ts's file doc comment) + a periodic,
  // zero-LLM-cost Meta-Cognition repeated-failure-pattern sweep sharing
  // the same tick.
  const schedulerTimer = startSchedulerLoop();

  // IoT Bridge — MQTT transport, opt-in only (0 = disabled, the default).
  // See iot/mqttBroker.ts's header for the full disclosed-scope contract.
  if (ServerConfig.mqttPort > 0) startMqttBroker(ServerConfig.mqttPort);

  const shutdown = (signal: string) => {
    logger.info('Shutting down', { signal });
    clearInterval(retentionTimer);
    clearInterval(schedulerTimer);
    stopMqttBroker();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Dedicated resilience-gap fix (defense in depth): this codebase has
  // several fire-and-forget dispatches with no attached .catch() by
  // design — runMission()/runPlanTask() via `void runPromise`,
  // resumeInterruptedPlans()/resumeInterruptedMissions()/
  // resumeInterruptedCouncilSessions() above, etc. Two concrete cases
  // (a mission or plan task that timed out waiting for a global
  // concurrency slot) were found and fixed at the source during this
  // pass — see missionRunner.ts's runMission() and taskManager.ts's
  // runPlanTask() for the full story — because with NO handler here,
  // Node.js (v15+) terminates the ENTIRE process on any unhandled
  // rejection, anywhere, taking down every other in-flight
  // mission/council/request with it. This is the safety net for any
  // similar gap not yet discovered: log it exactly like every other
  // caught failure in this codebase already does, and keep serving
  // traffic — a lost/failed background task is recoverable (this
  // system is durable-by-design and resumable across real restarts
  // already), a crashed process taking down unrelated in-flight work
  // is not. Deliberately NOT mirrored for uncaughtException: a
  // synchronous throw can leave in-process state genuinely
  // inconsistent, so Node's own default (log and exit) is the safer
  // choice there and is left untouched.
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection (process kept alive — see index.ts comment)', {
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
}

main().catch((e) => {
  logger.error('Fatal startup error', { message: (e as Error).message, stack: (e as Error).stack });
  process.exit(1);
});
