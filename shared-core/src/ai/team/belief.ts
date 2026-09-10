import { createDeck, shuffleDeck } from '../../lib/deck';
import { getPlayInfo } from '../../lib/rules';
import { PlayType, type Card, type PlayAction, type PlayerId, type PlayResolution } from '../../types/game';
import type { RandomSource } from '../random';
import { holdingCanBeat, summarizeHolding, type HoldingShapes } from './holdingShapes';
import type { TeamObservation, TeamDecisionRecord } from './types';

export const faceKey = (card: Card): string => `${card.suit}:${card.rank}`;
type PassEvidence = { target: PlayAction; laterCards: Card[]; voluntary: boolean };
type Sample = { shapes: Map<PlayerId, HoldingShapes>; weight: number };

const collectPassEvidence = (view: TeamObservation): Map<PlayerId, PassEvidence[]> => {
  const evidence = new Map<PlayerId, PassEvidence[]>();
  let target: PlayAction | null = null;
  let passes = 0;
  const remaining = new Map(view.seats.map(seat => [seat.id, seat.count]));
  for (const play of view.history) remaining.set(play.playerId, (remaining.get(play.playerId) ?? 0) + play.cards.length);
  for (const action of view.history) {
    if (action.type !== PlayType.Pass && action.cards.length) {
      for (const item of evidence.get(action.playerId) ?? []) item.laterCards.push(...action.cards);
      remaining.set(action.playerId, (remaining.get(action.playerId) ?? 0) - action.cards.length);
      target = action;
      passes = 0;
    } else if (target) {
      const items = evidence.get(action.playerId) ?? [];
      items.push({ target, laterCards: [], voluntary: view.seats.find(s => s.id === action.playerId)?.team
        === view.seats.find(s => s.id === target!.playerId)?.team });
      evidence.set(action.playerId, items.slice(-3));
      passes++;
      const otherActive = [...remaining].filter(([id, count]) => id !== target!.playerId && count > 0).length;
      if (passes >= otherActive) target = null;
    }
  }
  return evidence;
};

/** Joint sampling without replacement from the unseen deck. Passes are soft
 * evidence, never proof of absence: players can conserve bombs or yield.
 * Probabilities are model estimates (not empirically calibrated win rates).
 */
export const createPublicBelief = (view: TeamObservation, random: RandomSource) => {
  const known = new Map<string, number>();
  const seenIds = new Set<string>();
  const remember = (card: Card) => {
    if (seenIds.has(card.id)) return;
    seenIds.add(card.id);
    known.set(faceKey(card), (known.get(faceKey(card)) ?? 0) + 1);
  };
  view.hand.forEach(remember);
  view.history.forEach(action => action.cards.forEach(remember));
  view.lastPlay?.cards.forEach(remember);
  const unseen = createDeck(view.level).filter(card => {
    const count = known.get(faceKey(card)) ?? 0;
    if (count > 0) { known.set(faceKey(card), count - 1); return false; }
    return true;
  });
  const others = view.seats.filter(seat => seat.id !== view.self && seat.count > 0);
  const required = others.reduce((sum, seat) => sum + seat.count, 0);
  const coverage = unseen.length ? Math.min(1, required / unseen.length) : 1;
  const valid = required <= unseen.length && ![...known.values()].some(count => count > 0);
  const count = valid ? (others.some(seat => seat.count <= 10) ? 32 : 12) : 0;
  const passes = collectPassEvidence(view);
  const samples: Sample[] = [];
  const globalShapes = summarizeHolding(unseen, view.profile);
  for (let index = 0; index < count; index++) {
    const shuffled = shuffleDeck(unseen, random);
    const shapes = new Map<PlayerId, HoldingShapes>();
    let offset = 0;
    let weight = 1;
    for (const seat of others) {
      const holding = shuffled.slice(offset, offset + seat.count);
      offset += seat.count;
      shapes.set(seat.id, summarizeHolding(holding, view.profile));
      for (const evidence of passes.get(seat.id) ?? []) {
        const target = evidence.target.resolution ?? getPlayInfo(evidence.target.cards, view.profile);
        if (!target) continue;
        const past = summarizeHolding([...holding, ...evidence.laterCards], view.profile);
        if (holdingCanBeat(past, target, evidence.target.cards.length)) {
          // Teammate passes carry almost no negative evidence.
          weight *= evidence.voluntary ? 0.98 : 0.65;
        }
      }
    }
    samples.push({ shapes, weight: Math.max(0.03, weight) });
  }
  const weightSum = samples.reduce((sum, sample) => sum + sample.weight, 0);
  const probabilities = new Map<string, number>();
  const probability = (player: PlayerId, target: PlayResolution, size: number, finish = false): number => {
    const key = `${player}:${target.type}:${target.maxValue}:${size}:${finish}`;
    const cached = probabilities.get(key);
    if (cached !== undefined) return cached;
    const seat = others.find(other => other.id === player);
    if (!seat || !holdingCanBeat(globalShapes, target, size, finish ? seat.count : undefined)) return 0;
    if (!count) return finish ? 0.15 : 0.5;
    const wins = samples.reduce((sum, sample) => sum + (holdingCanBeat(
      sample.shapes.get(player)!, target, size, finish ? seat.count : undefined,
    ) ? sample.weight : 0), 0);
    // Keep a small uncertainty floor unless the public deck proves impossibility.
    const value = (wins + 0.12) / (weightSum + 0.24);
    probabilities.set(key, value);
    return value;
  };
  const summaries: TeamDecisionRecord['beliefs'] = others.map(seat => {
    const shapes: Partial<Record<PlayType, number>> = {};
    for (const type of Object.values(PlayType)) {
      if (type === PlayType.Pass) continue;
      const hits = samples.reduce((sum, sample) => sum + ([...sample.shapes.get(seat.id)!.values()]
        .some(shape => shape.type === type) ? sample.weight : 0), 0);
      shapes[type] = weightSum ? Number((hits / weightSum).toFixed(3)) : 0;
    }
    return { player: seat.id, count: seat.count, shapes };
  });
  return { probability, summaries, sampleCount: count, coverage: valid ? coverage : 0 };
};
