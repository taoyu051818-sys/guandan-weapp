import { Node, UITransform, Vec3 } from 'cc'

export type EffectPoint = Readonly<{ x: number, y: number, z?: number }>
export type EffectSize = Readonly<{ width: number, height: number }>
export type LegacyCoordinateOrigin = 'center' | 'top-left'
export type LegacyCoordinateFit = 'contain' | 'cover' | 'stretch'

export type LegacyCoordinateSpace = Readonly<{
  width: number
  height: number
  origin: LegacyCoordinateOrigin
  fit: LegacyCoordinateFit
}>

const DEFAULT_LEGACY_SPACE: LegacyCoordinateSpace = Object.freeze({ width: 1280, height: 720, origin: 'center', fit: 'contain' })

/** Adapts old animation coordinates without moving current gameplay nodes. */
export class LegacyCoordinateAdapter {
  public readonly source: LegacyCoordinateSpace

  public constructor (source: Partial<LegacyCoordinateSpace> = {}) {
    this.source = Object.freeze({ ...DEFAULT_LEGACY_SPACE, ...source })
    if (this.source.width <= 0 || this.source.height <= 0) throw new Error('Legacy coordinate space must have a positive size')
  }

  /** Maps one old point into a centered destination coordinate system. */
  public mapPoint (point: EffectPoint, destination: EffectSize): Vec3 {
    const scale = this.scaleFor(destination)
    const centered = this.centerSourcePoint(point)
    return new Vec3(centered.x * scale.x, centered.y * scale.y, point.z ?? 0)
  }

  public unmapPoint (point: EffectPoint, destination: EffectSize): Vec3 {
    const scale = this.scaleFor(destination)
    const centeredX = point.x / scale.x
    const centeredY = point.y / scale.y
    if (this.source.origin === 'top-left') {
      return new Vec3(centeredX + this.source.width / 2, this.source.height / 2 - centeredY, point.z ?? 0)
    }
    return new Vec3(centeredX, centeredY, point.z ?? 0)
  }

  public mapSize (size: EffectSize, destination: EffectSize): EffectSize {
    const scale = this.scaleFor(destination)
    return { width: size.width * scale.x, height: size.height * scale.y }
  }

  /** Uses the smaller axis for strokes, particle sizes and other scalar values. */
  public mapLength (length: number, destination: EffectSize): number {
    const scale = this.scaleFor(destination)
    return length * Math.min(scale.x, scale.y)
  }

  public toLocal (point: EffectPoint, targetRoot: Node, destination?: EffectSize): Vec3 {
    return this.mapPoint(point, destination ?? this.nodeSize(targetRoot))
  }

  public toWorld (point: EffectPoint, targetRoot: Node, destination?: EffectSize): Vec3 {
    const local = this.toLocal(point, targetRoot, destination)
    const transform = targetRoot.getComponent(UITransform)
    return transform?.convertToWorldSpaceAR(local) ?? Vec3.add(new Vec3(), targetRoot.worldPosition, local)
  }

  public fromLocal (point: EffectPoint, targetRoot: Node, destination?: EffectSize): Vec3 {
    return this.unmapPoint(point, destination ?? this.nodeSize(targetRoot))
  }

  public fromWorld (point: Vec3, targetRoot: Node, destination?: EffectSize): Vec3 {
    const transform = targetRoot.getComponent(UITransform)
    const local = transform?.convertToNodeSpaceAR(point) ?? Vec3.subtract(new Vec3(), point, targetRoot.worldPosition)
    return this.fromLocal(local, targetRoot, destination)
  }

  private centerSourcePoint (point: EffectPoint): { x: number, y: number } {
    if (this.source.origin === 'top-left') return { x: point.x - this.source.width / 2, y: this.source.height / 2 - point.y }
    return { x: point.x, y: point.y }
  }

  private scaleFor (destination: EffectSize): { x: number, y: number } {
    if (destination.width <= 0 || destination.height <= 0) throw new Error('Destination coordinate space must have a positive size')
    const horizontal = destination.width / this.source.width
    const vertical = destination.height / this.source.height
    if (this.source.fit === 'stretch') return { x: horizontal, y: vertical }
    const uniform = this.source.fit === 'cover' ? Math.max(horizontal, vertical) : Math.min(horizontal, vertical)
    return { x: uniform, y: uniform }
  }

  private nodeSize (node: Node): EffectSize {
    const size = node.getComponent(UITransform)?.contentSize
    if (!size || size.width <= 0 || size.height <= 0) return { width: this.source.width, height: this.source.height }
    return { width: size.width, height: size.height }
  }
}
