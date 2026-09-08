/** Plain JSON DTO boundary only: not for Cocos nodes, Dates, maps or gateway objects. */
export type DataSnapshot<T> = T extends object ? { readonly [K in keyof T]: DataSnapshot<T[K]> } : T

export function copyData<T> (value: DataSnapshot<T>): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function snapshotData<T> (value: DataSnapshot<T>): DataSnapshot<T> {
  const freeze = (item: unknown): void => {
    if (!item || typeof item !== 'object') return
    Object.values(item).forEach(freeze)
    Object.freeze(item)
  }
  const snapshot = copyData<T>(value)
  freeze(snapshot)
  return snapshot as DataSnapshot<T>
}
