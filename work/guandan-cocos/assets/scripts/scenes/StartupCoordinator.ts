import { game, type Node, type Texture2D } from 'cc'
import { ensureGameAssetBundle, type GameAssetBundleProgress } from '../services/GameAssetLoader'
import { preloadAllClassicCardFrames } from '../ui/ClassicCardFrameStore'
import { StartupLoadingOverlay } from '../ui/StartupLoadingOverlay'
import type { TableViewport } from '../ui/ScreenAdapter'
import type { SceneBackdropController } from './SceneBackdropController'

export interface StartupCoordinatorDependencies {
  sceneRoot: Node
  startupTexture: Texture2D | null
  initialViewport: TableViewport
  backdrop: SceneBackdropController
  initializeApplication: () => void
  resizeApplication: (viewport: TableViewport) => void
  onReady: () => void
}

export class StartupCoordinator {
  private overlay: StartupLoadingOverlay | null
  private attempt = 0
  private loading = false
  private initializationStarted = false
  private initialized = false
  private sceneStarted = false
  private readyPublished = false
  private disposed = false

  constructor (private readonly dependencies: StartupCoordinatorDependencies) {
    this.overlay = new StartupLoadingOverlay(
      dependencies.sceneRoot,
      dependencies.startupTexture,
      1280,
      590
    )
    this.overlay.resize(dependencies.initialViewport)
    this.overlay.setProgress(0, '正在检查游戏资源...')
  }

  begin (): void {
    if (this.disposed || this.loading || this.initializationStarted) return
    this.loading = true
    const attempt = ++this.attempt
    void this.run(attempt)
  }

  markSceneStarted (): void {
    if (this.disposed) return
    this.sceneStarted = true
    this.publishReady()
  }

  resize (viewport: TableViewport): void {
    if (this.disposed) return
    this.overlay?.resize(viewport)
    if (this.initialized) this.dependencies.resizeApplication(viewport)
  }

  dispose (): void {
    if (this.disposed) return
    this.disposed = true
    this.attempt += 1
    this.loading = false
    this.overlay?.dispose()
    this.overlay = null
  }

  private async run (attempt: number): Promise<void> {
    const overlay = this.overlay
    if (!overlay || !this.isCurrent(attempt)) return

    overlay.setProgress(0.03, '正在连接资源服务...')
    try {
      await ensureGameAssetBundle((progress) => {
        if (!this.isCurrent(attempt) || !this.overlay) return
        const normalized = Math.min(1, Math.max(0, progress.progress))
        this.overlay.setProgress(
          0.03 + normalized * 0.82,
          this.downloadStatus(progress)
        )
      })
      if (!this.isCurrent(attempt)) return
      overlay.setProgress(0.88, '正在准备牌面与大厅画面...')

      const [, cardSkinReady] = await Promise.all([
        this.dependencies.backdrop.preload('lobby'),
        preloadAllClassicCardFrames()
      ])
      if (!cardSkinReady) throw new Error('Classic card artwork is incomplete.')
    } catch (error) {
      if (!this.isCurrent(attempt) || !this.overlay) return
      this.loading = false
      console.error('Unable to prepare the game asset bundle.', error)
      this.overlay.showError('资源下载失败，请检查网络后重试', () => this.begin())
      return
    }

    if (!this.isCurrent(attempt) || !this.overlay) return
    this.overlay.setProgress(0.96, '正在创建游戏界面...')
    this.initializationStarted = true
    try {
      this.dependencies.initializeApplication()
    } catch (error) {
      if (!this.isCurrent(attempt) || !this.overlay) return
      this.loading = false
      console.error('Unable to initialize the game scene.', error)
      this.overlay.showError('游戏初始化失败，请重新进入小游戏', () => {
        void game.restart().catch((restartError) => {
          console.error('Unable to restart the game scene.', restartError)
          this.overlay?.showError('重新进入失败，请关闭后再次打开小游戏', () => {
            void game.restart()
          })
        })
      })
      return
    }

    if (!this.isCurrent(attempt) || !this.overlay) return
    this.initialized = true
    this.loading = false
    this.publishReady()
    this.overlay.bringToFront()
    this.overlay.setProgress(1, '资源准备完成')
    await this.overlay.fadeOut()
    if (this.isCurrent(attempt) && this.overlay === overlay) this.overlay = null
  }

  private publishReady (): void {
    if (this.disposed || !this.initialized || !this.sceneStarted || this.readyPublished) return
    this.readyPublished = true
    this.dependencies.onReady()
  }

  private isCurrent (attempt: number): boolean {
    return !this.disposed && attempt === this.attempt && this.dependencies.sceneRoot.isValid
  }

  private downloadStatus (progress: GameAssetBundleProgress): string {
    const total = progress.totalBytesExpectedToWrite
    if (total <= 0) return '正在下载游戏资源...'
    const writtenMb = (progress.totalBytesWritten / 1_048_576).toFixed(1)
    const totalMb = (total / 1_048_576).toFixed(1)
    return `正在下载游戏资源 ${writtenMb} / ${totalMb} MB`
  }
}
