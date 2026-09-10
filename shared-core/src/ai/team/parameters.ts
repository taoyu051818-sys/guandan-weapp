/** Relative weights layered over the tactical hand-strength weights.
 * One immutable production policy for hints, trustees and robots. Experimental
 * alternatives live only in scripts/support, never in engine/network options.
 */
export type TeamPolicyParameters = Readonly<{
  route: number;
  singles: number;
  resource: number;
  control: number;
  enemyFinish: number;
  allyFinish: number;
  allyFeed: number;
  rankConservation: number;
  temperature: number;
}>;

// 2026-09-10: retain reference weights. Seven challengers, 1,216 games;
// the frozen finalist did not clear the independent paired-confidence gate.
// See docs/TEAM_POLICY_TUNING_20260910.md before changing these constants.
export const TEAM_POLICY_PARAMETERS: TeamPolicyParameters = Object.freeze({
  route: 1, singles: 1, resource: 1, control: 1, enemyFinish: 1,
  allyFinish: 1, allyFeed: 1, rankConservation: 1, temperature: 1,
});
