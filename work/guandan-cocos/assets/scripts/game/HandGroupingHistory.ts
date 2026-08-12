export type HistoryCloner<T> = (value: T) => T

/** Bounded undo/redo ownership for presentation state; stored values are always cloned. */
export class HandGroupingHistory<T> {
  private undoStack: T[] = []
  private redoStack: T[] = []
  private readonly limit: number

  public constructor (limit: number, private readonly clone: HistoryCloner<T>) {
    this.limit = Math.max(1, Math.floor(limit))
  }

  public get canUndo (): boolean { return this.undoStack.length > 0 }
  public get canRedo (): boolean { return this.redoStack.length > 0 }

  public clear (): void {
    this.undoStack = []
    this.redoStack = []
  }

  public record (previous: T): void {
    this.pushUndo(previous)
    this.redoStack = []
  }

  public undo (current: T): T | null {
    const previous = this.undoStack.pop()
    if (!previous) return null
    this.redoStack.push(this.clone(current))
    return this.clone(previous)
  }

  public redo (current: T): T | null {
    const next = this.redoStack.pop()
    if (!next) return null
    this.pushUndo(current)
    return this.clone(next)
  }

  private pushUndo (value: T): void {
    this.undoStack.push(this.clone(value))
    if (this.undoStack.length > this.limit) this.undoStack.shift()
  }
}
