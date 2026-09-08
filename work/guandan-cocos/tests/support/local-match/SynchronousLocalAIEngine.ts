import {
  createAIEngine,
  createAIWorkerRequest,
  createAIWorkerRuntime,
} from '../../../assets/scripts/core/generated'
import type {
  AIContext,
  AIEngineCheckpoint,
  AIWorkerRuntimeConfig,
  Card,
  Difficulty,
  HardRuntimeTuning,
  MasterRuntimeTuning,
  PlayAction,
  Player,
  PlayerId,
  RuleProfile,
  Team,
} from '../../../assets/scripts/core/generated'
import type { LocalAIEngine } from './LocalMatchController'

export type SynchronousLocalAIEngineOptions = Readonly<{
  ruleProfile: RuleProfile
  seed: number
  hardTuning?: Partial<HardRuntimeTuning>
  masterTuning?: Partial<MasterRuntimeTuning>
}>

const cloneCheckpoint = (checkpoint: AIEngineCheckpoint): AIEngineCheckpoint =>
  JSON.parse(JSON.stringify(checkpoint)) as AIEngineCheckpoint

/**
 * Portable Worker-protocol adapter for runtimes where no real Worker is enabled.
 * Delayed turn invalidation remains owned by LocalAITurnController.
 */
export class SynchronousLocalAIEngine implements LocalAIEngine {
  private runtime = createAIWorkerRuntime()
  private readonly runtimeConfig: AIWorkerRuntimeConfig
  private readonly initialCheckpoint: AIEngineCheckpoint
  private currentCheckpoint: AIEngineCheckpoint
  private requestId = 0
  private generation = 0
  private disposed = false

  public constructor (options: SynchronousLocalAIEngineOptions) {
    const bootstrap = createAIEngine(options)
    this.runtimeConfig = {
      seed: options.seed,
      hardTuning: bootstrap.getHardRuntimeTuning(),
      masterTuning: bootstrap.getMasterRuntimeTuning(),
    }
    this.initialCheckpoint = bootstrap.checkpoint()
    this.currentCheckpoint = cloneCheckpoint(this.initialCheckpoint)
  }

  public makeDecision (
    hand: Card[],
    lastPlay: PlayAction | null,
    difficulty: Difficulty,
    myTeam: Team,
    players: Record<PlayerId, Player>,
    playerId?: PlayerId,
    context?: AIContext,
  ): Card[] | null {
    if (this.disposed) throw new Error('Local AI engine is disposed')
    if (!playerId || !context) throw new Error('Local AI decision context is incomplete')
    const expectedGeneration = this.generation
    const response = this.runtime.handle(createAIWorkerRequest(
      ++this.requestId,
      {
        hand,
        lastPlay,
        difficulty,
        myTeam,
        players,
        myPlayerId: playerId,
        aiContext: context,
      },
      this.runtimeConfig,
      this.currentCheckpoint,
    ))
    if (this.disposed || expectedGeneration !== this.generation) return null
    if (response.error) throw new Error(response.error)
    if (!response.checkpoint) throw new Error('Local AI runtime omitted its checkpoint')
    this.currentCheckpoint = response.checkpoint
    return response.decision
  }

  public checkpoint (): AIEngineCheckpoint {
    return cloneCheckpoint(this.currentCheckpoint)
  }

  public restore (checkpoint: AIEngineCheckpoint): void {
    if (this.disposed) throw new Error('Local AI engine is disposed')
    this.generation += 1
    this.runtime = createAIWorkerRuntime()
    this.currentCheckpoint = cloneCheckpoint(checkpoint)
  }

  public reset (): void {
    if (this.disposed) return
    this.generation += 1
    this.runtime = createAIWorkerRuntime()
    this.currentCheckpoint = cloneCheckpoint(this.initialCheckpoint)
  }

  public dispose (): void {
    this.disposed = true
    this.generation += 1
  }
}

export const createSynchronousLocalAIEngine = (
  options: SynchronousLocalAIEngineOptions,
): SynchronousLocalAIEngine => new SynchronousLocalAIEngine(options)
