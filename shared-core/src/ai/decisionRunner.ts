import { ruleProfileKey, type RuleProfile } from '../lib/rules';
import type { Card, PlayAction, Player, PlayerId, Team } from '../types/game';
import type { CandidateService } from './candidates';
import type { RandomSource } from './random';
import type { CachedPlayInfo } from './scoring';
import { chooseTeamPlay } from './team/policy';
import type { TeamDecisionRecord } from './team/types';
import type { AIContext, AIDecisionMetrics, AIDecisionTrace, AIEngine, Difficulty } from './types';

type DecisionRunnerOptions = Readonly<{
  engineRuleProfile: RuleProfile;
  random: RandomSource;
  metrics: AIDecisionMetrics;
  trace: AIDecisionTrace;
  resolvePlay: (cards: Card[], target: PlayAction | null) => CachedPlayInfo;
  getPossiblePlays: CandidateService['getPossiblePlays'];
  generateAllPlays: CandidateService['generateAllPlays'];
  recordTeamDecision: (record: TeamDecisionRecord) => void;
  resetMetrics: () => void;
}>;
const nowMs = () => typeof performance !== 'undefined' ? performance.now() : Date.now();

/** Projects public information before entering the only decision policy. */
export const createDecisionRunner = ({
  engineRuleProfile, random, metrics, trace, resolvePlay, getPossiblePlays,
  generateAllPlays, recordTeamDecision, resetMetrics,
}: DecisionRunnerOptions): Pick<AIEngine, 'makeDecision'> => ({
  makeDecision: (
    hand: Card[], lastPlay: PlayAction | null, _difficulty: Difficulty,
    myTeam: Team, players: Record<PlayerId, Player>, myPlayerId: PlayerId = 'p2', aiContext?: AIContext,
  ): Card[] | null => {
    resetMetrics();
    const start = nowMs();
    try {
      if (aiContext && ruleProfileKey(aiContext.ruleProfile) !== ruleProfileKey(engineRuleProfile)) {
        throw new Error('AI decision rule profile is incompatible with this engine');
      }
      trace.difficulty = 'master';
      trace.passReason = '';
      delete trace.team;
      const decision = chooseTeamPlay({
        hand, self: myPlayerId, team: myTeam,
        seats: Object.values(players).map(player => ({ id: player.id, team: player.team, count: player.hand.length })),
        order: aiContext?.turnOrder ?? ['p1', 'p2', 'p3', 'p4'],
        lastPlay, history: aiContext?.publicHistory ?? (lastPlay ? [lastPlay] : []),
        historyComplete: aiContext?.publicHistory !== undefined,
        level: aiContext?.currentLevel ?? hand.find(card => card.isLevelCard)?.rank ?? 2,
        profile: engineRuleProfile, roundId: aiContext?.roundId, revision: aiContext?.revision,
        finishedPlayers: aiContext?.finishedPlayers ?? [],
      }, getPossiblePlays(hand, lastPlay), () => generateAllPlays(hand), random, resolvePlay);
      trace.team = decision.record;
      trace.role = decision.record.strength?.plan === 'support' ? 'support' : 'striker';
      if (!decision.cards) trace.passReason = decision.record.reason;
      recordTeamDecision(decision.record);
      metrics.endgameNodes = decision.nodes;
      return decision.cards;
    } finally { metrics.elapsedMs = Math.max(0, nowMs() - start); }
  },
});
