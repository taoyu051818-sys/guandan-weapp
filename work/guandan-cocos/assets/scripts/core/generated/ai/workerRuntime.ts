import { createAIEngine, type AIEngine } from './index';
import {
  aiWorkerEngineConfigKey,
  assertAIWorkerRequest,
  type AIWorkerResponse,
} from './workerProtocol';

export interface AIWorkerRuntime {
  handle(message: unknown): AIWorkerResponse;
}

export const createAIWorkerRuntime = (): AIWorkerRuntime => {
  let engine: AIEngine | null = null;
  let engineConfigKey = '';
  let completedCheckpointKey = '';

  return {
    handle(message) {
      const response: AIWorkerResponse = {
        id: -1,
        decision: null,
      };
      try {
        assertAIWorkerRequest(message);
        response.id = message.id;
        const nextConfigKey = aiWorkerEngineConfigKey(message.engine);
        if (!engine || engineConfigKey !== nextConfigKey) {
          engine = createAIEngine(message.engine);
          engineConfigKey = nextConfigKey;
          completedCheckpointKey = '';
        }
        const suppliedCheckpointKey = message.checkpoint
          ? JSON.stringify(message.checkpoint)
          : '';
        const continuesCompletedDecision = Boolean(
          suppliedCheckpointKey
          && suppliedCheckpointKey === completedCheckpointKey,
        );
        // An error after this point invalidates the fast continuation marker.
        completedCheckpointKey = '';
        if (message.checkpoint && !continuesCompletedDecision) engine.restore(message.checkpoint);

        response.decision = engine.makeDecision(
          message.hand,
          message.lastPlay,
          message.difficulty,
          message.myTeam,
          message.players,
          message.myPlayerId,
          message.aiContext,
        );
        response.metrics = engine.getLastMetrics();
        response.checkpoint = engine.checkpoint();
        completedCheckpointKey = JSON.stringify(response.checkpoint);
      } catch (error) {
        completedCheckpointKey = '';
        response.error = error instanceof Error ? error.message : 'unknown worker error';
      }
      return response;
    },
  };
};
