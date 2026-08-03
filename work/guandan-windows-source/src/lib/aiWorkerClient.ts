import { Card, PlayAction, Player, PlayerId, Team } from '../types/game';
import type { AIDecisionMetrics, AIContext } from './ai';

type WorkerRequest = {
  id: number;
  hand: Card[];
  lastPlay: PlayAction | null;
  difficulty: 'easy' | 'medium' | 'hard' | 'master';
  myTeam: Team;
  players: Record<PlayerId, Player>;
  myPlayerId: PlayerId;
  aiContext?: AIContext;
};

type WorkerResponse = {
  id: number;
  decision: Card[] | null;
  metrics?: AIDecisionMetrics;
  error?: string;
};

type PendingResolver = {
  resolve: (value: Card[] | null) => void;
  reject: (reason?: unknown) => void;
};

export class AIWorkerClient {
  private worker: Worker;
  private seq = 1;
  private pending = new Map<number, PendingResolver>();
  private lastMetrics: AIDecisionMetrics | null = null;

  constructor() {
    this.worker = new Worker(new URL('../workers/aiWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const payload = event.data;
      const resolver = this.pending.get(payload.id);
      if (!resolver) return;
      this.pending.delete(payload.id);
      if (payload.error) {
        resolver.reject(new Error(payload.error));
        return;
      }
      this.lastMetrics = payload.metrics ?? null;
      resolver.resolve(payload.decision);
    };
  }

  public requestDecision(input: Omit<WorkerRequest, 'id'>): Promise<Card[] | null> {
    const id = this.seq++;
    this.worker.postMessage({ ...input, id });
    return new Promise<Card[] | null>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  public dispose() {
    this.pending.forEach(({ reject }) => reject(new Error('AI worker disposed')));
    this.pending.clear();
    this.worker.terminate();
  }

  public getLastMetrics(): AIDecisionMetrics | null {
    return this.lastMetrics ? { ...this.lastMetrics } : null;
  }
}
