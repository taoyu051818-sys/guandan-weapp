import type { PlayResolution, PlayerId } from '../../types/game';
import type { TeamObservation } from './types';

type Probability = (player: PlayerId, target: PlayResolution, size: number, finish?: boolean) => number;

/** Approximate responses in actual play order. A player who finishes ends the
 * first-place race immediately; later seats must not dilute that outcome.
 */
export const estimateTableOutlook = (
  view: TeamObservation, info: PlayResolution, size: number, probability: Probability,
) => {
  const selfIndex = view.order.indexOf(view.self);
  const afterSelf = Array.from({ length: view.order.length - 1 }, (_, offset) =>
    view.order[(selfIndex + offset + 1) % view.order.length])
    .map(id => view.seats.find(seat => seat.id === id)!).filter(seat => seat.count > 0);
  let reach = 1;
  let enemyFinish = 0;
  let allyFinish = 0;
  let enemyBeat = 0;
  for (const seat of afterSelf) {
    const beat = probability(seat.id, info, size);
    const finish = probability(seat.id, info, size, true);
    if (seat.team === view.team) {
      allyFinish += reach * finish;
      reach *= 1 - finish;
    } else {
      enemyFinish += reach * finish;
      enemyBeat += reach * beat;
      reach *= 1 - finish - Math.max(0, beat - finish) * (seat.count <= 10 ? 0.9 : 0.65);
    }
  }
  return { allyFinish, enemyFinish: Math.min(1, enemyFinish), control: Math.max(0, 1 - enemyBeat) };
};
