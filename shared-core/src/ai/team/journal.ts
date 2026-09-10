import { PlayType } from '../../types/game';
import type { TeamDecisionRecord } from './types';

const seats = new Set(['p1', 'p2', 'p3', 'p4']);
const playTypes = new Set(Object.values(PlayType));
const probability = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;
const count = (n: number, max: number) => Number.isInteger(n) && n >= 0 && n <= max;
const ids = (value: string[]) => Array.isArray(value) && value.length <= 27
  && value.every(id => typeof id === 'string' && id.length <= 128);
export const cloneTeamRecords = (records: readonly TeamDecisionRecord[]): TeamDecisionRecord[] =>
  JSON.parse(JSON.stringify(records)) as TeamDecisionRecord[];

/** Optional in legacy checkpoint v1; retained by v2 migration.
 * Server-private, bounded diagnostic data; never sent in player snapshots.
 */
export const validateTeamRecords = (value: unknown): TeamDecisionRecord[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8 || JSON.stringify(value).length > 60000) {
    throw new Error('Invalid AI team decision journal');
  }
  try {
    for (const item of value as TeamDecisionRecord[]) {
      if (item.policy !== 'team-first-v1' || item.objective !== 'team-first-place'
        || !seats.has(item.player) || typeof item.reason !== 'string' || item.reason.length > 80
        || !ids(item.selected) || !count(item.priority, 100) || !count(item.estimatedTurns, 27)
        || !probability(item.historyCoverage) || !count(item.sampleCount, 32)
        || (item.roundId !== undefined && !count(item.roundId, Number.MAX_SAFE_INTEGER))
        || (item.revision !== undefined && !count(item.revision, Number.MAX_SAFE_INTEGER))
        || item.beliefs.length > 3 || item.candidates.length > 6) throw new Error();
      if (item.strength && (!['strong', 'balanced', 'weak'].includes(item.strength.tier)
        || !['close', 'attack', 'support', 'develop'].includes(item.strength.plan)
        || !Number.isFinite(item.strength.controls) || item.strength.controls < 0 || item.strength.controls > 27
        || !count(item.strength.turns, 27) || !count(item.strength.singles, 27))) throw new Error();
      for (const belief of item.beliefs) {
        if (!seats.has(belief.player) || !count(belief.count, 27)
          || !Object.entries(belief.shapes).every(([type, p]) => playTypes.has(type as PlayType) && probability(p))) throw new Error();
      }
      for (const candidate of item.candidates) {
        if (!ids(candidate.cards) || !playTypes.has(candidate.type) || !Number.isFinite(candidate.score)
          || !count(candidate.turns, 27) || !probability(candidate.probability)
          || !probability(candidate.allyFinish) || !probability(candidate.enemyFinish)
          || !probability(candidate.control)) throw new Error();
      }
    }
  } catch { throw new Error('Invalid AI team decision journal'); }
  return cloneTeamRecords(value as TeamDecisionRecord[]);
};

export const createTeamJournal = () => {
  let records: TeamDecisionRecord[] = [];
  return {
    add: (record: TeamDecisionRecord) => {
      if (record.roundId !== undefined && records.length && records[0].roundId !== record.roundId) records = [];
      records.push(cloneTeamRecords([record])[0]);
      records = records.slice(-8);
    },
    checkpoint: () => cloneTeamRecords(records),
    restore: (value: unknown) => { records = validateTeamRecords(value); },
    reset: () => { records = []; },
  };
};
