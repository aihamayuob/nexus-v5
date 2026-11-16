import { getRepos } from '../persistence/repos.js';
import { logger } from '../core/logger.js';

export const ExecutionCheckpoint = {
  async save(taskId: string, phase: string, state: unknown): Promise<void> {
    try {
      getRepos().checkpoints.saveCheckpoint(taskId, phase, state);
    } catch (e) {
      logger.warn('Checkpoint save failed (non-fatal)', { taskId, phase, message: (e as Error).message });
    }
  },

  latest(taskId: string) {
    return getRepos().checkpoints.latestCheckpoint(taskId);
  },

  async clear(taskId: string): Promise<void> {
    try {
      getRepos().checkpoints.clearTask(taskId);
    } catch (e) {
      logger.warn('Checkpoint clear failed (non-fatal)', { taskId, message: (e as Error).message });
    }
  },

  /** Task ids for plans that were left in a non-terminal state — genuine resumability, checked once at process startup, same spirit as the frontend's checkForResumable() but backed by durable per-node state instead of a single localStorage slot. */
  resumablePlanTaskIds(): string[] {
    return getRepos().checkpoints.resumablePlanTaskIds();
  },
};
