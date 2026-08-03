import { createDeck, dealCards, shuffleDeck } from '../src/lib/deck';
import { getLastAIMetrics, getPossiblePlays, makeDecision, setHardRuntimeTuning, type HardRuntimeTuning } from '../src/lib/ai';
import { canPlay, getPlayInfo } from '../src/lib/rules';
import { Card, PlayAction, PlayType, Player, PlayerId, Team } from '../src/types/game';
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

type Difficulty = 'easy' | 'medium' | 'hard';
type Setup = { name: string; diff: Record<PlayerId, Difficulty> };

const ORDER: PlayerId[] = ['p1', 'p2', 'p3', 'p4'];
const TEAM_OF: Record<PlayerId, Team> = { p1: 'teamA', p2: 'teamB', p3: 'teamA', p4: 'teamB' };

type SimState = {
  players: Record<PlayerId, Player>;
  currentTurn: PlayerId;
  playArea: PlayAction[];
  lastValidPlay: PlayAction | null;
  finishedPlayers: PlayerId[];
  turnOrder: PlayerId[];
};

type CandidateResult = {
  tuning: HardRuntimeTuning;
  phase: 'explore' | 'final';
  games: number;
  hardVsMediumWinRate: number;
  hardVsEasyWinRate: number;
  hardAvgElapsedMs: number;
  hardPassWhenPlayableRate: number;
  score: number;
};

const setPlayer = (id: PlayerId, hand: Card[]): Player => ({
  id,
  name: id.toUpperCase(),
  isAI: true,
  team: TEAM_OF[id],
  hand,
  role: 'normal',
});

const clonePlayers = (hands: Record<PlayerId, Card[]>) => ({
  p1: setPlayer('p1', [...hands.p1]),
  p2: setPlayer('p2', [...hands.p2]),
  p3: setPlayer('p3', [...hands.p3]),
  p4: setPlayer('p4', [...hands.p4]),
});

const isGameOver = (state: SimState) => {
  if (state.finishedPlayers.length >= 3) return true;
  if (state.finishedPlayers.length >= 2) {
    const a = state.players[state.finishedPlayers[0]];
    const b = state.players[state.finishedPlayers[1]];
    if (a.team === b.team) return true;
  }
  return false;
};

const appendFinished = (state: SimState, playerId: PlayerId) => {
  if (state.players[playerId].hand.length === 0 && !state.finishedPlayers.includes(playerId)) {
    state.finishedPlayers.push(playerId);
  }
};

const nextAliveFrom = (state: SimState, from: PlayerId): PlayerId | null => {
  let idx = state.turnOrder.indexOf(from);
  for (let i = 0; i < 4; i++) {
    idx = (idx + 1) % 4;
    const pid = state.turnOrder[idx];
    if (state.players[pid].hand.length > 0) return pid;
  }
  return null;
};

const advanceTurn = (state: SimState) => {
  if (isGameOver(state)) return;
  const nextTurnId = nextAliveFrom(state, state.currentTurn);
  if (!nextTurnId) return;
  let nextValidPlay = state.lastValidPlay;
  if (nextValidPlay) {
    const lastPlayerId = nextValidPlay.playerId;
    const alivePlayers = state.turnOrder.filter((pId) => state.players[pId].hand.length > 0);
    let lastPlayIndex = -1;
    for (let i = state.playArea.length - 1; i >= 0; i--) {
      const p = state.playArea[i];
      if (p.playerId === lastPlayerId && p.type !== PlayType.Pass && p.cards.length > 0) {
        lastPlayIndex = i;
        break;
      }
    }
    if (lastPlayIndex !== -1) {
      const actionsAfter = state.playArea.slice(lastPlayIndex + 1);
      const passCount = actionsAfter.filter((a) => a.type === PlayType.Pass).length;
      const expectedPasses = alivePlayers.length - (state.players[lastPlayerId].hand.length > 0 ? 1 : 0);
      if (passCount >= expectedPasses) {
        nextValidPlay = null;
        if (state.players[lastPlayerId].hand.length === 0) {
          const lastIdx = state.turnOrder.indexOf(lastPlayerId);
          const teammateId = state.turnOrder[(lastIdx + 2) % 4];
          if (state.players[teammateId].hand.length > 0) {
            state.currentTurn = teammateId;
            state.lastValidPlay = null;
            return;
          }
          state.currentTurn = nextTurnId;
          state.lastValidPlay = null;
          return;
        }
        state.currentTurn = lastPlayerId;
        state.lastValidPlay = null;
        return;
      }
    }
  }
  state.currentTurn = nextTurnId;
  state.lastValidPlay = nextValidPlay;
};

const removeCards = (hand: Card[], played: Card[]) => {
  const ids = new Set(played.map((c) => c.id));
  return hand.filter((c) => !ids.has(c.id));
};

type BatchMetrics = {
  setupWins: Record<string, number>;
  setupGames: Record<string, number>;
  hardDecisions: number;
  hardElapsedMs: number;
  hardPlayablePass: number;
};

const runBatch = (gamesPerSetup: number, setups: Setup[]): BatchMetrics => {
  const metrics: BatchMetrics = {
    setupWins: {},
    setupGames: {},
    hardDecisions: 0,
    hardElapsedMs: 0,
    hardPlayablePass: 0,
  };

  for (const s of setups) {
    metrics.setupWins[s.name] = 0;
    metrics.setupGames[s.name] = 0;
    for (let i = 0; i < gamesPerSetup; i++) {
      const deck = shuffleDeck(createDeck(2));
      const hands = dealCards(deck);
      const state: SimState = {
        players: clonePlayers(hands),
        currentTurn: 'p1',
        playArea: [],
        lastValidPlay: null,
        finishedPlayers: [],
        turnOrder: [...ORDER],
      };
      let guard = 0;
      while (!isGameOver(state) && guard < 3000) {
        guard++;
        const pid = state.currentTurn;
        const player = state.players[pid];
        if (player.hand.length === 0) {
          const next = nextAliveFrom(state, pid);
          if (!next) break;
          state.currentTurn = next;
          continue;
        }
        const difficulty = s.diff[pid];
        let decision = makeDecision(player.hand, state.lastValidPlay, difficulty, player.team, state.players, pid);
        const aiMetrics = getLastAIMetrics();
        if (difficulty === 'hard') {
          metrics.hardDecisions += 1;
          metrics.hardElapsedMs += aiMetrics.elapsedMs;
          const playable = getPossiblePlays(player.hand, state.lastValidPlay, difficulty).length > 0;
          if (!decision && playable) metrics.hardPlayablePass += 1;
        }

        const mustFollow = !!state.lastValidPlay && state.lastValidPlay.type !== PlayType.Pass;
        if (decision && mustFollow && !canPlay(decision, state.lastValidPlay!)) decision = null;
        let action: PlayAction;
        if (!decision || decision.length === 0) {
          action = { playerId: pid, cards: [], type: PlayType.Pass };
        } else {
          const info = getPlayInfo(decision);
          action = info ? { playerId: pid, cards: decision, type: info.type } : { playerId: pid, cards: [], type: PlayType.Pass };
        }

        if (action.type === PlayType.Pass) {
          state.playArea.push(action);
        } else {
          state.players[pid] = { ...state.players[pid], hand: removeCards(state.players[pid].hand, action.cards) };
          state.playArea.push(action);
          state.lastValidPlay = action;
          appendFinished(state, pid);
        }
        advanceTurn(state);
      }

      const first = state.finishedPlayers[0] ?? 'p2';
      const winnerTeam = TEAM_OF[first];
      metrics.setupGames[s.name] += 1;
      if (winnerTeam === 'teamA') metrics.setupWins[s.name] += 1;
    }
  }
  return metrics;
};

const scoreCandidate = (m: BatchMetrics) => {
  const hvm = (m.setupWins['hard+hard vs medium+medium'] || 0) / Math.max(1, m.setupGames['hard+hard vs medium+medium'] || 1);
  const hve = (m.setupWins['hard+hard vs easy+easy'] || 0) / Math.max(1, m.setupGames['hard+hard vs easy+easy'] || 1);
  const elapsed = m.hardElapsedMs / Math.max(1, m.hardDecisions);
  const passRate = m.hardPlayablePass / Math.max(1, m.hardDecisions);
  const score = hvm * 100 + hve * 70 - elapsed * 0.8 - passRate * 80;
  return { hvm, hve, elapsed, passRate, score };
};

const main = () => {
  const started = performance.now();
  const setups: Setup[] = [
    { name: 'hard+hard vs medium+medium', diff: { p1: 'hard', p3: 'hard', p2: 'medium', p4: 'medium' } },
    { name: 'hard+hard vs easy+easy', diff: { p1: 'hard', p3: 'hard', p2: 'easy', p4: 'easy' } },
  ];

  const candidates: HardRuntimeTuning[] = [
    { interceptThreshold: 6, pairProbeMin: 7, pairProbeMax: 12, straightFlushBombBreakPenalty: 85 },
    { interceptThreshold: 7, pairProbeMin: 7, pairProbeMax: 12, straightFlushBombBreakPenalty: 85 },
    { interceptThreshold: 8, pairProbeMin: 7, pairProbeMax: 12, straightFlushBombBreakPenalty: 85 },
    { interceptThreshold: 8, pairProbeMin: 6, pairProbeMax: 12, straightFlushBombBreakPenalty: 85 },
    { interceptThreshold: 8, pairProbeMin: 6, pairProbeMax: 13, straightFlushBombBreakPenalty: 85 },
    { interceptThreshold: 8, pairProbeMin: 6, pairProbeMax: 13, straightFlushBombBreakPenalty: 70 },
    { interceptThreshold: 8, pairProbeMin: 6, pairProbeMax: 13, straightFlushBombBreakPenalty: 100 },
    { interceptThreshold: 9, pairProbeMin: 6, pairProbeMax: 13, straightFlushBombBreakPenalty: 85 },
    { interceptThreshold: 9, pairProbeMin: 5, pairProbeMax: 13, straightFlushBombBreakPenalty: 85 },
    { interceptThreshold: 9, pairProbeMin: 5, pairProbeMax: 14, straightFlushBombBreakPenalty: 85 },
  ];

  const results: CandidateResult[] = [];

  for (const tuning of candidates) {
    setHardRuntimeTuning(tuning);
    const batch = runBatch(20, setups);
    const s = scoreCandidate(batch);
    results.push({
      tuning: { ...tuning },
      phase: 'explore',
      games: 40,
      hardVsMediumWinRate: Number(s.hvm.toFixed(4)),
      hardVsEasyWinRate: Number(s.hve.toFixed(4)),
      hardAvgElapsedMs: Number(s.elapsed.toFixed(3)),
      hardPassWhenPlayableRate: Number(s.passRate.toFixed(4)),
      score: Number(s.score.toFixed(3)),
    });
  }

  const top3 = [...results].sort((a, b) => b.score - a.score).slice(0, 3);
  for (const c of top3) {
    setHardRuntimeTuning(c.tuning);
    const batch = runBatch(80, setups);
    const s = scoreCandidate(batch);
    results.push({
      tuning: { ...c.tuning },
      phase: 'final',
      games: 160,
      hardVsMediumWinRate: Number(s.hvm.toFixed(4)),
      hardVsEasyWinRate: Number(s.hve.toFixed(4)),
      hardAvgElapsedMs: Number(s.elapsed.toFixed(3)),
      hardPassWhenPlayableRate: Number(s.passRate.toFixed(4)),
      score: Number(s.score.toFixed(3)),
    });
  }

  const finals = results.filter((r) => r.phase === 'final');
  const best = (finals.length ? finals : results).sort((a, b) => b.score - a.score)[0];
  setHardRuntimeTuning(best.tuning);

  const output = {
    generatedAt: new Date().toISOString(),
    totalCandidates: candidates.length,
    totalRuns: results.length,
    best,
    elapsedMs: Number((performance.now() - started).toFixed(2)),
    results,
  };

  mkdirSync('reports', { recursive: true });
  writeFileSync('reports/ai-auto-tune-report.json', JSON.stringify(output, null, 2), 'utf8');
  console.log(JSON.stringify(output, null, 2));
};

main();
