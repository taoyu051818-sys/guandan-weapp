import { Label, Node, Tween, UITransform } from 'cc'
import {
  EFFECT_LAYERS,
  EFFECT_PALETTES,
  rgba,
  type EffectLayer,
  type EffectPaletteTone,
  type EffectStyle,
  type EffectTypeRole,
} from './EffectDesignSystem'

const DEFAULT_WIDTH = 1280
const DEFAULT_HEIGHT = 720
const nodeLayers = new WeakMap<Node, EffectLayer>()

export type ResponsiveEffectRootOptions = Readonly<{
  layer?: EffectLayer
  padding?: number
  fallbackWidth?: number
  fallbackHeight?: number
}>

export type EffectLabelOptions = Readonly<{
  text: string
  role: EffectTypeRole
  name?: string
  tone?: EffectPaletteTone
  layer?: EffectLayer
  width?: number
  height?: number
}>

const finitePositive = (value: number | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback

/** Keeps effect ordering semantic even when nodes are created in a different order. */
export const setEffectLayer = (node: Node, layer: EffectLayer): void => {
  nodeLayers.set(node, layer)
  const parent = node.parent
  if (!parent) return
  const ordered = parent.children.slice().sort((left, right) =>
    (nodeLayers.get(left) ?? EFFECT_LAYERS.SUBJECT) - (nodeLayers.get(right) ?? EFFECT_LAYERS.SUBJECT))
  ordered.forEach((child, index) => child.setSiblingIndex(index))
}

export const syncResponsiveEffectSize = (
  node: Node,
  parent: Node,
  padding = 0,
  fallbackWidth = DEFAULT_WIDTH,
  fallbackHeight = DEFAULT_HEIGHT,
): UITransform => {
  const parentSize = parent.getComponent(UITransform)?.contentSize
  const width = finitePositive(parentSize?.width, fallbackWidth) + Math.max(0, padding) * 2
  const height = finitePositive(parentSize?.height, fallbackHeight) + Math.max(0, padding) * 2
  const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform)
  transform.setContentSize(width, height)
  return transform
}

/** Creates an initially responsive effect root without assuming a 1280x720 parent. */
export const createResponsiveEffectRoot = (
  parent: Node,
  name: string,
  options: ResponsiveEffectRootOptions = {},
): Node => {
  const root = new Node(name)
  root.parent = parent
  syncResponsiveEffectSize(
    root,
    parent,
    options.padding ?? 0,
    options.fallbackWidth ?? DEFAULT_WIDTH,
    options.fallbackHeight ?? DEFAULT_HEIGHT,
  )
  setEffectLayer(root, options.layer ?? EFFECT_LAYERS.BACK_FX)
  return root
}

/** Shared display type: fixed scale, shrink overflow and an ink outline. */
export const createOutlinedEffectLabel = (parent: Node, style: EffectStyle, options: EffectLabelOptions): Node => {
  const token = style.typeScale[options.role]
  const node = new Node(options.name ?? 'EffectLabel')
  node.parent = parent
  node.addComponent(UITransform).setContentSize(options.width ?? token.defaultWidth, options.height ?? token.lineHeight + 16)
  const label = node.addComponent(Label)
  label.string = options.text
  label.fontSize = token.fontSize
  label.lineHeight = token.lineHeight
  label.horizontalAlign = Label.HorizontalAlign.CENTER
  label.verticalAlign = Label.VerticalAlign.CENTER
  label.overflow = Label.Overflow.SHRINK
  label.enableWrapText = false
  label.color = rgba(style.palette[options.tone ?? 'primary'])
  label.enableOutline = true
  label.outlineColor = rgba(EFFECT_PALETTES.ink.primary, 224)
  label.outlineWidth = token.outlineWidth
  setEffectLayer(node, options.layer ?? EFFECT_LAYERS.COPY)
  return node
}

/** Dimming is disabled until a reviewed full-screen sprite replaces the old code-drawn rectangle. */
export const createEffectDimmer = (_parent: Node, _style: EffectStyle, _alpha = _style.dimmerAlpha): Node | null => null

/** Cancels every tween owned by a transient tree before pooling or destruction. */
export const stopTree = (node: Node): void => {
  node.children.forEach(stopTree)
  Tween.stopAllByTarget(node)
  node.components.forEach(component => Tween.stopAllByTarget(component))
}
