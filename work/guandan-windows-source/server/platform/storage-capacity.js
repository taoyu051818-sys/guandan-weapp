// Advisory budgets for the single-writer JSON store, not production capacity claims.
export const STORAGE_BUDGETS = Object.freeze({ snapshotBytes: 64 * 1024 * 1024, auditBytes: 32 * 1024 * 1024, auditEntries: 100000 })

export function storageCapacity (state, snapshotBytes, { exactAuditBytes = false } = {}) {
  const ops = state.operations
  const usage = {
    snapshotBytes,
    auditBytes: exactAuditBytes || !Number.isSafeInteger(ops?.auditBytes) ? Buffer.byteLength(JSON.stringify(ops?.audit || [])) : ops.auditBytes,
    auditEntries: ops?.audit?.length || 0,
  }
  const metrics = Object.entries(STORAGE_BUDGETS).map(([name, budget]) => {
    const used = usage[name]
    return { name, used, budget, status: used >= budget ? 'critical' : used >= budget * 0.8 ? 'warning' : 'ok' }
  })
  return { metrics, status: metrics.some(m => m.status === 'critical') ? 'critical' : metrics.some(m => m.status === 'warning') ? 'warning' : 'ok' }
}

export function createStorageCapacityObserver (logger = console) {
  let previous = ''
  return report => {
    const signature = report.metrics.map(m => m.status).join(',')
    if (signature === previous) return
    previous = signature
    if (report.status !== 'ok') {
      // No payloads, user names, file paths or credentials in operational logs.
      try { logger.warn?.('PLATFORM_STORAGE_CAPACITY', report) } catch { /* observability must not break committed writes */ }
    }
  }
}
