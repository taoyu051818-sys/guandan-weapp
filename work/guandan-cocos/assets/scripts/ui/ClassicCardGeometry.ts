export type ClassicCardLayer = 'background' | 'cornerRank' | 'cornerSuit' | 'center'

export type ClassicCardLayerGeometry = Readonly<{
  width: number
  height: number
  x: number
  y: number
  z: number
}>

export const CLASSIC_CARD_REFERENCE_SIZE = Object.freeze({ width: 82, height: 118 })

/** Shared geometry keeps hand cards and VFX snapshots pixel-identical. */
export const CLASSIC_CARD_LAYER_GEOMETRY: Readonly<Record<ClassicCardLayer, ClassicCardLayerGeometry>> = Object.freeze({
  background: Object.freeze({ width: 76, height: 112, x: 0, y: 0, z: 0 }),
  cornerRank: Object.freeze({ width: 27, height: 36, x: -25, y: 37, z: 2 }),
  cornerSuit: Object.freeze({ width: 31, height: 31, x: 2, y: 37, z: 2 }),
  center: Object.freeze({ width: 56, height: 56, x: 8, y: -22, z: 1 }),
})

export const CLASSIC_CARD_JOKER_GEOMETRY: ClassicCardLayerGeometry = Object.freeze({
  width: 74,
  height: 106,
  x: 0,
  y: 0,
  z: 1,
})
