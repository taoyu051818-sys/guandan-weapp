import type { Node } from 'cc'

/** Raise only existing siblings: no reparent/scale change may disturb hand hit testing. */
export const orderTableLayers = (root: Node, layers: readonly (Node | null | undefined)[]): void => {
  layers.forEach(node => {
    if (node?.isValid && node.parent === root) node.setSiblingIndex(root.children.length - 1)
  })
}
