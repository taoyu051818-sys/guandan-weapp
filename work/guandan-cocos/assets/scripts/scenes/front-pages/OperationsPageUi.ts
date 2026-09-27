import type { RuntimeUiFactory } from '../../ui/RuntimeUiFactory'
import type { TableViewport } from '../../ui/ScreenAdapter'
import { SecondaryPageShell, secondaryColors } from '../../ui/SecondaryPageUi'

export const operationsPalette = secondaryColors

/** Operations pages share the player-page shell, never global lobby/table defaults. */
export class OperationsPageUi extends SecondaryPageShell {
  public constructor (parent: RuntimeUiFactory, viewport: TableViewport, title: string, back: () => void) {
    super(parent, title, back, viewport)
  }
}
