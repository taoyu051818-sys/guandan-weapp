import { assetManager } from 'cc'
import type { Asset, AssetManager, Constructor } from 'cc'

const GAME_ASSET_BUNDLE = 'game-assets'
const BUNDLE_LOAD_TIMEOUT_MS = 30_000
const ASSET_LOAD_TIMEOUT_MS = 15_000

export type GameAssetBundleProgress = Readonly<{
  /** Normalized progress in the inclusive 0..1 range on every platform. */
  progress: number
  totalBytesWritten: number
  totalBytesExpectedToWrite: number
}>

export type GameAssetBundleProgressCallback = (progress: GameAssetBundleProgress) => void
export type GameAssetLoadCallback<T extends Asset> = (error: Error | null, asset: T | null) => void
export type GameAssetLoadOptions = Readonly<{
  /** Bounds both bundle readiness and the individual Bundle.load callback. */
  timeoutMs?: number
  signal?: AbortSignal
}>
export type GameAssetLoadCancel = () => void

export class GameAssetLoadError extends Error {
  public constructor (
    message: string,
    public readonly code: 'ASSET_LOAD_TIMEOUT' | 'ASSET_LOAD_CANCELLED' | 'ASSET_LOAD_FAILED',
  ) {
    super(message)
    this.name = 'GameAssetLoadError'
  }
}

let pendingBundle: Promise<AssetManager.Bundle> | null = null
const progressListeners = new Set<GameAssetBundleProgressCallback>()

function toError (value: unknown): Error {
  if (value instanceof Error) return value
  if (value && typeof value === 'object' && 'errMsg' in value) {
    return new Error(String((value as { errMsg: unknown }).errMsg))
  }
  return new Error(String(value ?? `Unable to load ${GAME_ASSET_BUNDLE}`))
}

type WeChatBundleProgress = Readonly<{
  progress: number
  totalBytesWritten: number
  totalBytesExpectedToWrite: number
}>

function finiteNonNegative (value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function notifyProgress (progressOrLoaded: WeChatBundleProgress | number, total = 0): void {
  const written = finiteNonNegative(typeof progressOrLoaded === 'number' ? progressOrLoaded : progressOrLoaded.totalBytesWritten)
  const expected = finiteNonNegative(typeof progressOrLoaded === 'number' ? total : progressOrLoaded.totalBytesExpectedToWrite)
  const progress = typeof progressOrLoaded === 'number'
    ? {
        progress: expected > 0 ? Math.min(1, written / expected) : 0,
        totalBytesWritten: written,
        totalBytesExpectedToWrite: expected,
      }
    : {
        progress: Math.min(1, finiteNonNegative(progressOrLoaded.progress) / 100),
        totalBytesWritten: written,
        totalBytesExpectedToWrite: expected,
      }
  progressListeners.forEach(listener => {
    try {
      listener(progress)
    } catch (error) {
      console.warn('Game asset progress listener failed.', error)
    }
  })
}

function loadBundle (): Promise<AssetManager.Bundle> {
  const loaded = assetManager.getBundle(GAME_ASSET_BUNDLE)
  if (loaded) return Promise.resolve(loaded)

  return new Promise((resolve, reject) => {
    let settled = false
    const watchdog = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error(`Timed out loading ${GAME_ASSET_BUNDLE} after ${BUNDLE_LOAD_TIMEOUT_MS / 1000} seconds`))
    }, BUNDLE_LOAD_TIMEOUT_MS)

    // Cocos forwards this hook to the platform's native subpackage task.
    try {
      assetManager.loadBundle(GAME_ASSET_BUNDLE, {
        onFileProgress: (progressOrLoaded: WeChatBundleProgress | number, total?: number) => {
          if (!settled) notifyProgress(progressOrLoaded, total)
        },
      }, (error, bundle) => {
        if (settled) return
        settled = true
        clearTimeout(watchdog)
        if (error || !bundle) {
          reject(error ?? new Error(`Unable to load ${GAME_ASSET_BUNDLE}`))
          return
        }
        resolve(bundle)
      })
    } catch (error) {
      if (settled) return
      settled = true
      clearTimeout(watchdog)
      reject(toError(error))
    }
  })
}

/** Resolves the bundle; Cocos loads its declared WeChat subpackage when needed. */
export function ensureGameAssetBundle (onProgress?: GameAssetBundleProgressCallback): Promise<AssetManager.Bundle> {
  const loaded = assetManager.getBundle(GAME_ASSET_BUNDLE)
  if (loaded) return Promise.resolve(loaded)
  if (onProgress) progressListeners.add(onProgress)

  if (!pendingBundle) {
    pendingBundle = loadBundle()
    const active = pendingBundle
    void active.then(
      () => {
        if (pendingBundle === active) pendingBundle = null
        progressListeners.clear()
      },
      () => {
        if (pendingBundle === active) pendingBundle = null
        progressListeners.clear()
      },
    )
  }
  return pendingBundle
}

/** Callback-compatible bounded load. Cancellation settles the callback and ignores late Cocos results. */
export function loadGameAsset<T extends Asset> (
  path: string,
  type: Constructor<T>,
  onComplete: GameAssetLoadCallback<T>,
  options: GameAssetLoadOptions = {},
): GameAssetLoadCancel {
  let settled = false
  const timeoutMs = Number.isFinite(options.timeoutMs) && Number(options.timeoutMs) > 0
    ? Number(options.timeoutMs)
    : ASSET_LOAD_TIMEOUT_MS
  const settle = (error: Error | null, asset: T | null): void => {
    if (settled) return
    settled = true
    clearTimeout(watchdog)
    options.signal?.removeEventListener('abort', cancel)
    onComplete(error, asset)
  }
  const cancel = (): void => settle(
    new GameAssetLoadError(`Cancelled loading game asset: ${path}`, 'ASSET_LOAD_CANCELLED'),
    null,
  )
  const watchdog = setTimeout(() => settle(
    new GameAssetLoadError(`Timed out loading game asset ${path} after ${timeoutMs / 1000} seconds`, 'ASSET_LOAD_TIMEOUT'),
    null,
  ), timeoutMs)

  if (options.signal?.aborted) cancel()
  else {
    options.signal?.addEventListener('abort', cancel, { once: true })
    void ensureGameAssetBundle().then(
      bundle => {
        if (settled) return
        try {
          bundle.load(path, type, (error, asset) => {
            if (error || !asset) {
              settle(error ? toError(error) : new GameAssetLoadError(`Unable to load game asset: ${path}`, 'ASSET_LOAD_FAILED'), null)
              return
            }
            settle(null, asset)
          })
        } catch (error) {
          settle(toError(error), null)
        }
      },
      error => settle(toError(error), null),
    )
  }
  return cancel
}

/** Promise-compatible asset load for bootstrap and future async call sites. */
export function loadGameAssetAsync<T extends Asset> (path: string, type: Constructor<T>, options: GameAssetLoadOptions = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    loadGameAsset(path, type, (error, asset) => {
      if (error || !asset) {
        reject(error ?? new Error(`Unable to load game asset: ${path}`))
        return
      }
      resolve(asset)
    }, options)
  })
}
