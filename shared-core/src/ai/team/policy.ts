import { resolvePlayForContext } from '../../lib/rules';
import { PlayType, type Card, type PlayAction, type PlayResolution } from '../../types/game';
import type { RandomSource } from '../random';
import { getPlayResourceDamage } from '../resourceProtection';
import { isBombType } from '../scoring';
import { createPublicBelief } from './belief';
import { createHandRoutePlanner } from './handRoute';
import { estimateTableOutlook } from './tableOutlook';
import { assessHandStrength, strengthWeights } from './handStrength';
import { TEAM_POLICY_PARAMETERS as parameters } from './parameters';
import type { TeamDecisionRecord, TeamObservation } from './types';

type Choice = {
  cards: Card[];
  info: PlayResolution;
  priority: number;
  score: number;
  turns: number;
  allyFinish: number;
  enemyFinish: number;
  control: number;
  probability: number;
};
const round = (value: number) => Number(value.toFixed(3));

/** Hard policy tiers first; probabilistic choice only within the winning tier.
 * Team first-place outranks personal card count. No hidden-hand search ports.
 */
export const chooseTeamPlay = (
  view: TeamObservation,
  possiblePlays: Card[][],
  generateLeads: () => Card[][],
  random: RandomSource,
  resolveSource: (cards: Card[], target: PlayAction | null) => PlayResolution | null =
    (cards, target) => resolvePlayForContext(cards, target, view.profile),
): { cards: Card[] | null; record: TeamDecisionRecord; nodes: number; ranked: Card[][] } => {
  let ranked: Card[][] = [];
  const record: TeamDecisionRecord = {
    policy: 'team-first-v1', objective: 'team-first-place', player: view.self,
    roundId: view.roundId, revision: view.revision, reason: '', priority: 0,
    selected: [], estimatedTurns: 0, historyCoverage: 0, sampleCount: 0,
    beliefs: [], candidates: [],
  };
  const resolutions = new Map<string, PlayResolution | null>();
  const resolve = (cards: Card[], target: PlayAction | null) => {
    const key = `${target ? 'follow' : 'lead'}:${cards.map(card => card.id).sort().join(',')}`;
    if (resolutions.has(key)) return resolutions.get(key)!;
    const info = resolveSource(cards, target);
    resolutions.set(key, info);
    return info;
  };
  const done = (cards: Card[] | null, reason: string, priority: number, nodes = 0) => {
    record.reason = reason;
    record.priority = priority;
    record.selected = cards?.map(card => card.id) ?? [];
    return { cards, record, nodes, ranked: ranked.length ? ranked : cards ? [cards] : [] };
  };
  const finish = possiblePlays.find(play => play.length === view.hand.length);
  if (finish) return done(finish, 'finish_hand', 100);
  const target = view.lastPlay?.type === PlayType.Pass ? null : view.lastPlay;
  const ally = view.seats.find(seat => seat.id !== view.self && seat.team === view.team)!;
  const allyControls = target && view.seats.find(seat => seat.id === target.playerId)?.team === view.team;
  const enemies = view.seats.filter(seat => seat.team !== view.team && seat.count > 0);
  const minEnemy = Math.min(...enemies.map(seat => seat.count));
  if (allyControls && minEnemy > 1) return done(null, 'teammate_yield', 90);
  if (!possiblePlays.length) return done(null, allyControls ? 'teammate_yield' : 'no_playable', 0);
  const urgent = minEnemy <= 2;
  const firstLead = !target && view.hand.length === 27;
  const belief = createPublicBelief(view, random);
  record.historyCoverage = round(belief.coverage);
  record.sampleCount = belief.sampleCount;
  record.beliefs = belief.summaries;
  let available = possiblePlays;
  if (allyControls && target) {
    const targetInfo = target.resolution ?? resolve(target.cards, null)!;
    const danger = estimateTableOutlook(view, targetInfo, target.cards.length, belief.probability).enemyFinish;
    // Exception to yielding: a one-card enemy is very likely to go out before
    // our ally, and a safe overtake denies it. Incomplete history cannot trigger it.
    available = belief.coverage >= 0.9 && danger >= 0.85 ? possiblePlays.filter(cards => {
      const outlook = estimateTableOutlook(view, resolve(cards, target)!, cards.length, belief.probability);
      return outlook.enemyFinish <= 0.05 && outlook.control >= 0.95;
    }) : [];
    if (!available.length) return done(null, 'teammate_yield', 90);
  }
  const planner = createHandRoutePlanner(view.hand, generateLeads(), view.profile, cards => resolve(cards, null));
  record.strength = assessHandStrength(view.hand, planner.whole(), ally.count);
  const weightsByStrength = strengthWeights(record.strength);
  const choices: Choice[] = available.map(cards => {
    const info = resolve(cards, target)!;
    const bomb = isBombType(info.type);
    const route = planner.after(cards);
    const damage = getPlayResourceDamage(view.hand, cards);
    let priority = 50;
    // Opening bombs are retained as control resources unless the whole hand
    // finishes (above), or no non-bomb lead exists at all.
    if (firstLead && bomb) priority = 20;
    if (urgent && !target && !bomb
      && enemies.some(enemy => enemy.count === cards.length)) priority = 35;
    if (urgent && !target && bomb) priority = 40;
    if (target && !urgent && bomb) priority = 30;
    // Prefer an intact ordinary response to breaking a bomb; a legal bomb is
    // allowed for an emergency, not forced merely because someone has 5 cards.
    if (damage.bombSplits > 0) priority -= 5;
    const { enemyFinish, allyFinish, control } = estimateTableOutlook(view, info, cards.length, belief.probability);
    const allySoon = ally.count > 0 && ally.count <= 10;
    const pip = bomb ? (info.type === PlayType.Rocket ? 22 : info.maxValue / 1000) : info.maxValue;
    let score = -route.turns * weightsByStrength.route * parameters.route - route.singles * 9 * parameters.singles;
    score -= (damage.bombSplits * 140 + damage.groupSplits * 8 + damage.wildcardCount * 24)
      * weightsByStrength.resource * parameters.resource;
    score -= bomb ? (firstLead ? 200 : 75) : pip * (target ? 1.3 : 2) * parameters.rankConservation;
    score += cards.length * 1.5;
    score += control * (urgent ? 115 : route.turns <= 2 ? 100 : weightsByStrength.control) * parameters.control;
    score -= enemyFinish * (urgent ? 1000 : 650) * parameters.enemyFinish;
    score += allyFinish * (allySoon ? weightsByStrength.allyFinish : 250) * parameters.allyFinish;
    if (!target && allySoon && !bomb) {
      score += belief.probability(ally.id, info, cards.length) * weightsByStrength.allyFeed * parameters.allyFeed;
      if (ally.count === 1 && info.type === PlayType.Single) score += (140 - pip * 3) * parameters.allyFeed;
    }
    if (urgent && target && !bomb) score += pip * 4;
    return { cards, info, priority, score, turns: route.turns, allyFinish,
      enemyFinish, control, probability: 0 };
  });
  const ordinary = choices.filter(choice => !isBombType(choice.info.type));
  if (target && !urgent && ordinary.length === 0) {
    // Do not burn the only control to collect an ordinary early trick. Short
    // whole-hand routes and enemies in the <=10-card sprint justify contest.
    const worthwhile = choices.some(choice => choice.turns <= 2 || minEnemy <= 10);
    if (!worthwhile) return done(null, 'preserve_bomb_control', 60, planner.nodes());
  }
  const priority = Math.max(...choices.map(choice => choice.priority));
  const eligible = choices.filter(choice => choice.priority === priority).sort((a, b) =>
    b.score - a.score || a.cards.map(card => card.id).join(',').localeCompare(b.cards.map(card => card.id).join(',')));
  // Probability changes only near-equal candidates. A bad line does not get
  // picked through global jitter, and emergencies are effectively deterministic.
  const contenders = eligible.filter(choice => choice.score >= eligible[0].score - (urgent ? 3 : 12));
  const temperature = (urgent ? 1 : 4) * parameters.temperature;
  const weights = contenders.map(choice => Math.exp((choice.score - eligible[0].score) / temperature));
  const sum = weights.reduce((total, weight) => total + weight, 0);
  contenders.forEach((choice, index) => { choice.probability = weights[index] / sum; });
  let cursor = contenders.length === 1 ? 0 : random();
  const selected = contenders.find(choice => (cursor -= choice.probability) < 0) ?? contenders[0];
  ranked = [selected.cards, ...eligible.filter(choice => choice !== selected).map(choice => choice.cards)];
  record.estimatedTurns = selected.turns + 1;
  const logged = [selected, ...eligible.filter(choice => choice !== selected)].slice(0, 6);
  record.candidates = logged.map(choice => ({ cards: choice.cards.map(card => card.id), type: choice.info.type,
    score: round(choice.score), probability: round(choice.probability), turns: choice.turns,
    allyFinish: round(choice.allyFinish), enemyFinish: round(choice.enemyFinish), control: round(choice.control) }));
  const reason = allyControls ? 'protect_ally_from_finish' : urgent ? 'deny_enemy_finish' : !target && ally.count > 0 && ally.count <= 10
    ? 'feed_ally_or_plan_exit' : firstLead ? 'opening_keep_control' : 'team_exit_route';
  return done(selected.cards, reason, priority, planner.nodes());
};
