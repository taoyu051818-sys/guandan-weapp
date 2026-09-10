/** Shared table controls in Cocos design units. Turn actions are 120% of the reviewed baseline. */
export const TABLE_BUTTON_HEIGHT = 58 * 1.2
export const TABLE_BUTTON_FONT = 28 * 1.2
export const TABLE_BUTTON_GAP = 8
export const tableButtonWidth = (text: string, primary = false): number =>
  Math.max((primary ? 128 : 112) * 1.2, Array.from(text).reduce((w, char) => w + (/[^\x00-\xff]/.test(char) ? 1 : 0.6), 0) * TABLE_BUTTON_FONT + 32)
