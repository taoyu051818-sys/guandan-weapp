import { describe, expect, it } from 'vitest';
import { TEAM_POLICY_PARAMETERS } from '../src/ai/team/parameters';

describe('single production team policy parameters', () => {
  it('keeps tactical weights immutable and finite', () => {
    expect(Object.isFrozen(TEAM_POLICY_PARAMETERS)).toBe(true);
    expect(Object.keys(TEAM_POLICY_PARAMETERS).sort()).toEqual([
      'allyFeed', 'allyFinish', 'control', 'enemyFinish', 'rankConservation',
      'resource', 'route', 'singles', 'temperature',
    ]);
    for (const value of Object.values(TEAM_POLICY_PARAMETERS)) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThanOrEqual(3);
    }
    expect(Reflect.set(TEAM_POLICY_PARAMETERS, 'route', 999)).toBe(false);
  });
});
