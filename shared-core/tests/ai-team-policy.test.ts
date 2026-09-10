import { describe, expect, it } from 'vitest';
import { createAIEngine } from '../src/ai';
import { createDeck, shuffleDeck } from '../src/lib/deck';
import { canPlay, getPlayInfo, getRuleProfile } from '../src/lib/rules';
import { createSeededRandom } from '../src/ai/random';
import { isBombType } from '../src/ai/scoring';
import { PlayType, type Card, type Player, type PlayerId, type PlayAction } from '../src/types/game';

const profile = getRuleProfile('classic');
const deck = createDeck(2);
const take = (rank: Card['rank'], n = 1) => deck.filter(card => card.rank === rank).slice(0, n);
const setup = (hand: Card[], counts = [hand.length, 17, 17, 17], seed = 57) => {
  const players = Object.fromEntries(['p1', 'p2', 'p3', 'p4'].map((id, index) => [id, {
    id, name: id, team: index % 2 ? 'teamB' : 'teamA', isAI: true, role: 'normal',
    hand: index === 0 ? hand : new Proxy(new Array(counts[index]), {
      get(target, key) {
        if (key !== 'length') throw new Error(`hidden hand access: ${id}.${String(key)}`);
        return target.length;
      },
    }),
  }])) as Record<PlayerId, Player>;
  const engine = createAIEngine({ seed, ruleProfile: profile });
  const context = { currentLevel: 2 as const, teamLevels: { teamA: 2 as const, teamB: 2 as const },
    roundMeta: null, ruleProfile: profile, publicHistory: [] as PlayAction[], roundId: 1, revision: 1 };
  const decide = (lastPlay: PlayAction | null = null) => {
    const play = engine.makeDecision(hand, lastPlay, 'master', 'teamA', players, 'p1', context);
    if (play) expect(canPlay(play, lastPlay, profile)).toBe(true);
    else expect(lastPlay).not.toBeNull();
    return play;
  };
  return { engine, players, context, decide };
};

describe('team-first master and trustee policy', () => {
  it.each(Array.from({ length: 12 }, (_, seed) => seed))('retains opening bombs and never reads hidden faces (seed %i)', seed => {
      const bomb = take(8, 4);
      const rest = shuffleDeck(deck.filter(card => !bomb.includes(card)), createSeededRandom(seed));
      const hand = [...bomb, ...rest.slice(0, 23)];
      const { decide, engine } = setup(hand, [27, 27, 27, 27], seed);
      const choice = decide()!;
      expect(isBombType(getPlayInfo(choice, profile)!.type)).toBe(false);
      expect(engine.getLastDecisionTrace().team?.reason).toBe('opening_keep_control');
      expect(engine.getLastDecisionTrace().team?.candidates.every(candidate => !isBombType(candidate.type))).toBe(true);
      expect(engine.getLastMetrics().endgameNodes).toBeLessThanOrEqual(350);
  });

  it('does not force a bomb just because an enemy has five cards', () => {
    const hand = [...take(5, 4), ...take('J'), ...take('K'), ...take(3)];
    const { decide } = setup(hand, [7, 5, 15, 16]);
    const choice = decide({ playerId: 'p4', cards: take(8), type: PlayType.Single })!;
    expect(getPlayInfo(choice, profile)?.type).toBe(PlayType.Single);
  });

  it('takes immediate first place even if doing so requires a bomb or overtaking an ally', () => {
    const hand = take(6, 4);
    const { decide, engine } = setup(hand);
    expect(decide({ playerId: 'p3', cards: take('A'), type: PlayType.Single })).toHaveLength(4);
    expect(engine.getLastDecisionTrace().team?.priority).toBe(100);
  });

  it('protects an ally against a near-certain one-card finish using complete public history', () => {
    const hand = [...take('Big'), ...take(4)];
    const unseen = [...take(9), ...take(10), ...take('J'), ...take('Q'), ...take('K')];
    const target: PlayAction = { playerId: 'p3', cards: take(3), type: PlayType.Single };
    const { decide, engine, context } = setup(hand, [2, 1, 3, 1]);
    const known = new Set([...hand, ...unseen, ...target.cards].map(card => card.id));
    context.publicHistory = [...deck.filter(card => !known.has(card.id)).map(card =>
      ({ playerId: 'p4', cards: [card], type: PlayType.Single }) as PlayAction), target];
    const chosen = decide(target)!;
    expect(chosen[0].rank).toBe('Big');
    expect(engine.getLastDecisionTrace().team?.reason).toBe('protect_ally_from_finish');
  });

  it('yields teammate control without any probabilistic override', () => {
    const { decide, engine } = setup([...take(6, 4), ...take('A'), ...take(3)], [6, 1, 3, 1]);
    expect(decide({ playerId: 'p3', cards: take(9), type: PlayType.Single })).toBeNull();
    expect(engine.getLastDecisionTrace().passReason).toBe('teammate_yield');
  });

  it('does not offer a one-card opponent a single when an intact pair can be led', () => {
    for (const enemy of [1, 3]) {
      const counts = [3, 15, 12, 15]; counts[enemy] = 1;
      const { decide } = setup([...take(6, 2), ...take('A')], counts);
      expect(getPlayInfo(decide()!, profile)?.type).toBe(PlayType.Pair);
    }
  });

  it('uses a strong ordinary response to stop an enemy sprint', () => {
    const { decide } = setup([...take(9), ...take('K')], [2, 1, 12, 10]);
    expect(decide({ playerId: 'p4', cards: take(8), type: PlayType.Single })?.[0].rank).toBe('K');
  });

  it('feeds a teammate on one card with a low single instead of pursuing only its own pairs', () => {
    const { decide, engine } = setup([...take(6, 2), ...take(9, 2), ...take(3), ...take('Big')], [6, 17, 1, 17]);
    const choice = decide()!;
    expect(choice).toHaveLength(1);
    expect(choice[0].rank).toBe(3);
    expect(engine.getLastDecisionTrace().team?.reason).toBe('feed_ally_or_plan_exit');
  });

  it('records bounded, copy-isolated probabilities and continues identically after checkpoint restore', () => {
    const subject = setup([...take(6, 2), ...take(9, 2), ...take(3), ...take('Big')], [6, 9, 8, 10]);
    for (let index = 0; index < 10; index++) { subject.context.revision++; subject.decide(); }
    const checkpoint = subject.engine.checkpoint();
    expect(checkpoint.teamDecisions).toHaveLength(8);
    const restored = createAIEngine({ seed: 1, ruleProfile: profile });
    restored.restore(JSON.parse(JSON.stringify(checkpoint)));
    const expected = subject.decide();
    const actual = restored.makeDecision(subject.players.p1.hand, null, 'master', 'teamA', subject.players, 'p1', subject.context);
    expect(actual).toEqual(expected);
    expect(restored.checkpoint()).toEqual(subject.engine.checkpoint());
    const trace = subject.engine.getLastDecisionTrace();
    expect(trace.team?.beliefs).toHaveLength(3);
    expect(trace.team?.sampleCount).toBe(32);
    expect(trace.team?.candidates[0].probability).toBeGreaterThan(0);
    trace.team!.selected.length = 0;
    expect(subject.engine.getLastDecisionTrace().team!.selected.length).toBeGreaterThan(0);
    checkpoint.teamDecisions![0].sampleCount = -1;
    expect(() => restored.restore(checkpoint)).toThrow(/journal/);
    const old = subject.engine.checkpoint(); delete old.teamDecisions;
    expect(() => restored.restore(old)).not.toThrow();
    subject.context.roundId++;
    subject.decide();
    expect(subject.engine.checkpoint().teamDecisions).toHaveLength(1);
  });
});
