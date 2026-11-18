import { createServer, type Server } from 'node:http';
import { Router } from './router.js';
import { registerChatRoutes } from '../routes/legacy/chat.js';
import { registerRuntimeRoutes } from '../routes/legacy/runtime.js';
import { registerEmbedRoutes } from '../routes/legacy/embed.js';
import { registerToolsAndMarketRoutes } from '../routes/legacy/toolsAndMarket.js';
import { registerAuditVetoRoutes } from '../routes/legacy/auditVeto.js';
import { registerScheduleRoutes } from '../routes/legacy/schedules.js';
import { registerSyncRoutes } from '../routes/legacy/sync.js';
import { registerV2Routes } from '../routes/v2/index.js';
import { registerV2TaskRoutes } from '../routes/v2/tasks.js';
import { registerApprovalRoutes } from '../routes/v2/approvals.js';
import { registerFeedbackRoutes } from '../routes/v2/feedback.js';
import { registerEvaluationRoutes } from '../routes/v2/evaluation.js';
import { registerEvolutionRoutes } from '../routes/v2/evolution.js';
import { registerKnowledgeFreshnessRoutes } from '../routes/v2/knowledgeFreshness.js';
import { registerFineTuningRoutes } from '../routes/v2/finetuning.js';
import { registerMissionRoutes } from '../routes/v2/missions.js';
import { registerCouncilRoutes } from '../routes/v2/council.js';
import { registerWardenRoutes } from '../routes/v2/warden.js';
import { registerSwarmRoutes } from '../routes/v2/swarm.js';
import { registerMetaCognitionRoutes } from '../routes/v2/metacognition.js';
import { registerDreamingRoutes } from '../routes/v2/dreaming.js';
import { registerIotRoutes } from '../routes/v2/iot.js';
import { registerResearchRoutes } from '../routes/v2/research.js';
import { registerMcpRoutes } from '../routes/v2/mcp.js';
import { registerA2aRoutes } from '../routes/v2/a2a.js';
import { registerExecutionReceiptRoutes } from '../routes/v2/executionReceipts.js';
import { ServerConfig } from '../config/env.js';
import { logger } from '../core/logger.js';
import { pruneStaleRateLimitBuckets } from './middleware/rateLimit.js';

export function buildRouter(): Router {
  const router = new Router();
  registerChatRoutes(router);
  registerRuntimeRoutes(router);
  registerEmbedRoutes(router);
  registerToolsAndMarketRoutes(router);
  registerAuditVetoRoutes(router);
  registerScheduleRoutes(router);
  registerSyncRoutes(router);
  registerV2Routes(router);
  registerV2TaskRoutes(router);
  registerApprovalRoutes(router);
  registerFeedbackRoutes(router);
  registerEvaluationRoutes(router);
  registerEvolutionRoutes(router);
  registerKnowledgeFreshnessRoutes(router);
  registerFineTuningRoutes(router);
  registerMissionRoutes(router);
  registerCouncilRoutes(router);
  registerWardenRoutes(router);
  registerSwarmRoutes(router);
  registerMetaCognitionRoutes(router);
  registerDreamingRoutes(router);
  registerIotRoutes(router);
  registerResearchRoutes(router);
  registerExecutionReceiptRoutes(router);
  registerMcpRoutes(router);
  registerA2aRoutes(router);
  return router;
}

export function createNexusServer(): Server {
  const router = buildRouter();
  const server = createServer((req, res) => {
    void router.handle(req, res);
  });

  const pruneInterval = setInterval(() => pruneStaleRateLimitBuckets(), 5 * 60_000);
  server.on('close', () => clearInterval(pruneInterval));

  return server;
}
export function startServer(): Server {
  const server = createNexusServer();
  server.listen(ServerConfig.port, ServerConfig.host, () => {
    logger.info('Nexus backend listening', { host: ServerConfig.host, port: ServerConfig.port, env: ServerConfig.nodeEnv });
  });
  return server;
}
