/// <reference lib="webworker" />

import { getLastAIMetrics, makeDecision, type AIDecisionMetrics, type AIContext } from '../lib/ai';
import { Card, PlayAction, Player, PlayerId, Team } from '../types/game';

type RequestPayload = {
  id: number;
  hand: Card[];
  lastPlay: PlayAction | null;
  difficulty: 'easy' | 'medium' | 'hard' | 'master';
  myTeam: Team;
  players: Record<PlayerId, Player>;
  myPlayerId: PlayerId;
  aiContext?: AIContext;
};

type ResponsePayload = {
  id: number;
  decision: Card[] | null;
  metrics?: AIDecisionMetrics;
  error?: string;
};

self.onmessage = (event: MessageEvent<RequestPayload>) => {
  const payload = event.data;
  try {
    const decision = makeDecision(
      payload.hand,
      payload.lastPlay,
      payload.difficulty,
      payload.myTeam,
      payload.players,
      payload.myPlayerId,
      payload.aiContext,
    );

    const response: ResponsePayload = {
      id: payload.id,
      decision,
      metrics: getLastAIMetrics(),
    };
    self.postMessage(response);
  } catch (error) {
    const response: ResponsePayload = {
      id: payload.id,
      decision: null,
      error: error instanceof Error ? error.message : 'unknown worker error',
    };
    self.postMessage(response);
  }
};
