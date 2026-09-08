import { markSnapshotAcceptancesDurable } from './room-state-store.js'
/** Owns this runtime responsibility; dependencies are injected by the server composition root. */
export const createRuntimePersistence = ({ roomStateStore, acceptedActions, persistedRuntimeSnapshot, debounceMs: PERSIST_DEBOUNCE_MS, isShuttingDown, setTimeout = globalThis.setTimeout, clearTimeout = globalThis.clearTimeout }) => {
  let runtimeDirty = false
  let persistTimer = null
  const markAllAcceptedActionsDurable = () => {
    for (const [key, accepted] of acceptedActions) acceptedActions.set(key, { ...accepted, pendingDurability: false })
  }
  const schedulePersistRetry = () => {
    if (!roomStateStore.configured || persistTimer || isShuttingDown()) return
    persistTimer = setTimeout(() => { void flushRuntimeState() }, Math.max(100, PERSIST_DEBOUNCE_MS))
    persistTimer.unref?.()
  }
  const flushRuntimeState = async ({ throwOnError = false } = {}) => {
    if (!roomStateStore.configured) { markAllAcceptedActionsDurable(); return }
    if (!runtimeDirty) return
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = null
    runtimeDirty = false
    const snapshot = persistedRuntimeSnapshot()
    const writtenAcceptances = new Map(snapshot.acceptedActions.map(([key, accepted]) => [key, accepted]))
    try {
      await roomStateStore.save(snapshot)
      markSnapshotAcceptancesDurable(acceptedActions, writtenAcceptances)
    } catch (error) {
      runtimeDirty = true
      console.error('Failed to persist WeApp room state:', error instanceof Error ? error.message : error)
      schedulePersistRetry()
      if (throwOnError) throw error
    }
  }
  const persistRuntimeState = () => {
    if (!roomStateStore.configured) return
    runtimeDirty = true
    if (persistTimer) return
    persistTimer = setTimeout(() => { void flushRuntimeState() }, PERSIST_DEBOUNCE_MS)
    persistTimer.unref?.()
  }
  const cancelPendingTimer = () => {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = null
  }
  return { persistRuntimeState, flushRuntimeState, cancelPendingTimer }
}
