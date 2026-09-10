import { Color, EditBox, Graphics, Label, Node, Sprite, SpriteFrame, Texture2D, UIOpacity, UITransform, Vec3, tween } from 'cc'
import { drawUiFrame, type UiFrameKind } from './UiFrameStyle'
import { loadGameAsset } from '../services/GameAssetLoader'

export type RuntimeTextInputOptions = {
  width?: number
  height?: number
  maxLength?: number
  fontSize?: number
  inputMode?: EditBox['inputMode']
  initialValue?: string
}

export type RuntimePanelStyle = {
  fill?: Color
  stroke?: Color
  lineWidth?: number
  frame?: UiFrameKind
  frameScale?: number
}

export type RuntimeLabelStyle = {
  color?: Color
  outlineColor?: Color
  outlineWidth?: number
  width?: number
  height?: number
  parent?: Node
}

export type RuntimeButtonStyle = RuntimePanelStyle & {
  pressedFill?: Color
  textColor?: Color
  textOutlineColor?: Color
  textOutlineWidth?: number
  disabled?: boolean
}

const imageFrames = new Map<string, SpriteFrame>()

export const RUNTIME_MIN_TEXT_SIZE = 20
export const RUNTIME_MIN_BUTTON_TEXT_SIZE = 22

const readableFontSize = (fontSize: number, minimum = RUNTIME_MIN_TEXT_SIZE): number => Math.max(minimum, Math.round(fontSize))

/** Keeps runtime text legible over illustrated tables without adding wrapper cards. */
export const applyForegroundTextStyle = (
  label: Label,
  outlineColor = new Color(27, 37, 34, 255),
  outlineWidth = 2,
): Label => {
  label.isBold = true
  label.enableOutline = true
  label.outlineColor = outlineColor
  const minimumOutline = label.fontSize >= 30 ? 4 : label.fontSize >= 24 ? 3 : 2
  label.outlineWidth = Math.max(minimumOutline, outlineWidth)
  return label
}

/**
 * Builds the temporary code-driven UI used until every screen has an authored
 * prefab. Keeping construction and button feedback here prevents page routing
 * and game orchestration from owning drawing details.
 */
export class RuntimeUiFactory {
  public constructor (private readonly root: Node) {}

  public get parent (): Node { return this.root }

  public label (name: string, x: number, y: number, fontSize: number): Label {
    const resolvedFontSize = readableFontSize(fontSize)
    const node = new Node(name)
    node.parent = this.root
    node.setPosition(new Vec3(x, y, 0))
    node.addComponent(UITransform).setContentSize(1100, 80)
    const label = node.addComponent(Label)
    label.fontSize = resolvedFontSize
    label.lineHeight = resolvedFontSize + 8
    label.color = new Color(245, 239, 215)
    label.horizontalAlign = Label.HorizontalAlign.CENTER
    return applyForegroundTextStyle(label)
  }

  public menuLabel (text: string, x: number, y: number, fontSize: number): Label {
    const resolvedFontSize = readableFontSize(fontSize)
    const lines = text.split('\n')
    const lineWidth = (line: string): number => Array.from(line).reduce(
      (width, character) => width + (/^[\u0000-\u00ff]$/.test(character) ? resolvedFontSize * 0.58 : resolvedFontSize),
      0,
    )
    const rootWidth = this.root.getComponent(UITransform)?.contentSize.width ?? 1280
    const maxWidth = Math.max(220, rootWidth - 64)
    const width = text.length
      ? Math.min(maxWidth, Math.max(120, Math.ceil(Math.max(...lines.map(lineWidth)) + 34)))
      : Math.min(760, maxWidth)
    const contentWidth = Math.max(1, width - 22)
    const renderedLineCount = lines.reduce(
      (count, line) => count + Math.max(1, Math.ceil(lineWidth(line) / contentWidth)),
      0,
    )
    const height = Math.max(resolvedFontSize + 18, renderedLineCount * (resolvedFontSize + 7) + 14)
    const container = new Node('MenuLabelBacking')
    container.parent = this.root
    container.setPosition(new Vec3(x, y - 10, 0))
    container.addComponent(UITransform).setContentSize(width, height)
    const graphics = container.addComponent(Graphics)
    graphics.fillColor = new Color(4, 9, 10, 158)
    drawUiFrame(graphics, -width / 2, -height / 2, width, height, 'tag')
    graphics.fill()

    const textNode = new Node('MenuLabel')
    textNode.parent = container
    textNode.addComponent(UITransform).setContentSize(width - 22, height - 8)
    const label = textNode.addComponent(Label)
    label.string = text
    label.fontSize = resolvedFontSize
    label.lineHeight = resolvedFontSize + 7
    label.overflow = Label.Overflow.SHRINK
    label.enableWrapText = true
    label.horizontalAlign = Label.HorizontalAlign.CENTER
    label.verticalAlign = Label.VerticalAlign.CENTER
    label.color = new Color(218, 179, 79)
    label.isBold = true
    label.enableOutline = true
    label.outlineColor = new Color(38, 26, 17, 255)
    label.outlineWidth = resolvedFontSize >= 30 ? 4 : resolvedFontSize >= 24 ? 3 : 2
    const opacity = container.addComponent(UIOpacity)
    opacity.opacity = 0
    tween(opacity).to(0.2, { opacity: 255 }).start()
    tween(container).to(0.22, { position: new Vec3(x, y, 0) }, { easing: 'quadOut' }).start()
    return label
  }

  public outlinedLabel (text: string, x: number, y: number, fontSize: number, style: RuntimeLabelStyle = {}): Label {
    const resolvedFontSize = readableFontSize(fontSize)
    const node = new Node('OutlinedLabel')
    node.parent = style.parent ?? this.root
    node.setPosition(new Vec3(x, y, 0))
    node.addComponent(UITransform).setContentSize(style.width ?? 500, style.height ?? Math.max(54, resolvedFontSize + 16))
    const label = node.addComponent(Label)
    label.string = text
    label.fontSize = resolvedFontSize
    label.lineHeight = resolvedFontSize + 6
    label.overflow = Label.Overflow.SHRINK
    label.horizontalAlign = Label.HorizontalAlign.CENTER
    label.verticalAlign = Label.VerticalAlign.CENTER
    label.color = style.color ?? new Color(255, 244, 199)
    return applyForegroundTextStyle(
      label,
      style.outlineColor ?? new Color(42, 29, 18, 255),
      style.outlineWidth ?? 3,
    )
  }

  public panel (name: string, x: number, y: number, width: number, height: number, style: RuntimePanelStyle = {}, parent?: Node): Node {
    const node = new Node(name)
    node.parent = parent ?? this.root
    node.setPosition(new Vec3(x, y, 0))
    node.addComponent(UITransform).setContentSize(width, height)
    const graphics = node.addComponent(Graphics)
    graphics.fillColor = style.fill ?? new Color(17, 49, 36, 220)
    graphics.strokeColor = style.stroke ?? new Color(229, 199, 104, 220)
    graphics.lineWidth = style.lineWidth ?? 2
    drawUiFrame(graphics, -width / 2, -height / 2, width, height, style.frame ?? 'panel', style.frameScale)
    graphics.fill()
    if ((style.lineWidth ?? 2) > 0) graphics.stroke()
    return node
  }

  public image (name: string, assetPath: string, x: number, y: number, width: number, height: number, parent?: Node): Node {
    const node = new Node(name)
    node.parent = parent ?? this.root
    node.setPosition(new Vec3(x, y, 0))
    node.addComponent(UITransform).setContentSize(width, height)
    const sprite = node.addComponent(Sprite)
    sprite.sizeMode = Sprite.SizeMode.CUSTOM
    const cached = imageFrames.get(assetPath)
    if (cached) sprite.spriteFrame = cached
    else loadGameAsset(assetPath, Texture2D, (error, texture) => {
      if (error || !texture) {
        console.warn(`Unable to load runtime UI image ${assetPath}.`, error)
        return
      }
      let frame = imageFrames.get(assetPath)
      if (!frame) {
        frame = new SpriteFrame()
        frame.texture = texture
        imageFrames.set(assetPath, frame)
      }
      if (node.isValid && sprite.isValid) sprite.spriteFrame = frame
    })
    return node
  }

  public imageCard (name: string, assetPath: string, x: number, y: number, width: number, height: number, onSelect: () => void, delay = 0): Node {
    const node = this.panel(name, x, y, width + 8, height + 8, {
      fill: new Color(255, 248, 220, 245),
      stroke: new Color(255, 220, 113, 255),
      lineWidth: 3,
      frame: 'panel',
    })
    this.image(`${name}Artwork`, assetPath, 0, 0, width, height, node)
    const opacity = node.addComponent(UIOpacity)
    opacity.opacity = 0
    node.setScale(new Vec3(0.96, 0.96, 1))
    tween(opacity).delay(delay).to(0.2, { opacity: 255 }).start()
    tween(node).delay(delay).to(0.22, { scale: Vec3.ONE }, { easing: 'backOut' }).start()
    this.makeInteractive(node, onSelect)
    return node
  }

  public makeInteractive (node: Node, onSelect: () => void, pressedScale = 0.96): void {
    node.on(Node.EventType.TOUCH_START, () => {
      tween(node).stop().to(0.06, { scale: new Vec3(pressedScale, pressedScale, 1) }).start()
    })
    node.on(Node.EventType.TOUCH_END, () => {
      tween(node).stop().to(0.08, { scale: Vec3.ONE }).call(onSelect).start()
    })
    node.on(Node.EventType.TOUCH_CANCEL, () => {
      tween(node).stop().to(0.08, { scale: Vec3.ONE }).start()
    })
  }

  public button (name: string, text: string, x: number, width = 244, height = 56, fontSize = 25, style: RuntimeButtonStyle = {}): Node {
    const resolvedFontSize = readableFontSize(fontSize, RUNTIME_MIN_BUTTON_TEXT_SIZE)
    const node = new Node(name)
    node.parent = this.root
    node.setPosition(new Vec3(x, -205, 0))
    node.addComponent(UITransform).setContentSize(width, height)
    const halfWidth = width / 2
    const halfHeight = height / 2
    const graphics = node.addComponent(Graphics)
    const draw = (pressed: boolean): void => {
      graphics.clear()
      graphics.fillColor = style.disabled
        ? new Color(65, 75, 68, 210)
        : pressed ? (style.pressedFill ?? new Color(96, 68, 28, 245)) : (style.fill ?? new Color(74, 50, 21, 235))
      graphics.strokeColor = style.stroke ?? new Color(218, 179, 79, 255)
      graphics.lineWidth = style.lineWidth ?? 2
      drawUiFrame(graphics, -halfWidth, -halfHeight, width, height, style.frame ?? 'control', style.frameScale)
      graphics.fill()
      if ((style.lineWidth ?? 2) > 0) graphics.stroke()
    }
    draw(false)

    const textNode = new Node('ButtonText')
    textNode.parent = node
    textNode.addComponent(UITransform).setContentSize(width - 14, height - 6)
    const label = textNode.addComponent(Label)
    label.fontSize = resolvedFontSize
    label.lineHeight = resolvedFontSize + 5
    label.overflow = Label.Overflow.SHRINK
    label.horizontalAlign = Label.HorizontalAlign.CENTER
    label.verticalAlign = Label.VerticalAlign.CENTER
    label.string = text
    label.color = style.disabled ? new Color(174, 181, 174) : (style.textColor ?? new Color(245, 224, 156))
    applyForegroundTextStyle(
      label,
      style.textOutlineColor ?? new Color(42, 29, 18, 255),
      style.textOutlineWidth ?? 2,
    )

    const opacity = node.addComponent(UIOpacity)
    opacity.opacity = 0
    node.setScale(new Vec3(0.9, 0.9, 1))
    tween(opacity).to(0.18, { opacity: 255 }).start()
    tween(node).to(0.2, { scale: Vec3.ONE }, { easing: 'backOut' }).start()
    if (style.disabled) return node
    node.on(Node.EventType.TOUCH_START, () => {
      draw(true)
      tween(node).stop().to(0.06, { scale: new Vec3(0.96, 0.96, 1) }).start()
    })
    const release = (): void => {
      draw(false)
      tween(node).stop().to(0.08, { scale: Vec3.ONE }).start()
    }
    node.on(Node.EventType.TOUCH_END, release)
    node.on(Node.EventType.TOUCH_CANCEL, release)
    return node
  }

  public formInput (name: string, placeholderText: string, x: number, y: number, options: RuntimeTextInputOptions = {}): EditBox {
    const width = options.width ?? 330
    const height = options.height ?? 50
    const node = new Node(name)
    node.parent = this.root
    node.setPosition(new Vec3(x, y, 0))
    node.addComponent(UITransform).setContentSize(width, height)
    const graphics = node.addComponent(Graphics)
    graphics.fillColor = new Color(12, 29, 32, 235)
    graphics.strokeColor = new Color(188, 143, 57, 220)
    graphics.lineWidth = 2
    drawUiFrame(graphics, -width / 2, -height / 2, width, height, 'control')
    graphics.fill()
    graphics.stroke()

    const editNode = new Node(`${name}Edit`)
    editNode.parent = node
    editNode.addComponent(UITransform).setContentSize(width - 30, height - 8)
    // Create the engine-reserved label nodes before EditBox. Adding EditBox
    // first makes Cocos create its own visible "label" node on the same frame.
    const inputText = new Node('TEXT_LABEL')
    inputText.parent = editNode
    const inputTransform = inputText.addComponent(UITransform)
    inputTransform.setContentSize(width - 50, height - 12)
    inputTransform.setAnchorPoint(0, 1)
    const resolvedInputFontSize = readableFontSize(options.fontSize ?? 22, RUNTIME_MIN_BUTTON_TEXT_SIZE)
    const textLabel = inputText.addComponent(Label)
    textLabel.fontSize = resolvedInputFontSize
    textLabel.lineHeight = resolvedInputFontSize + 6
    textLabel.horizontalAlign = Label.HorizontalAlign.CENTER
    textLabel.verticalAlign = Label.VerticalAlign.CENTER
    textLabel.color = new Color(245, 239, 215)
    textLabel.string = ''
    applyForegroundTextStyle(textLabel, new Color(24, 37, 34, 255), 2)
    const placeholder = new Node('PLACEHOLDER_LABEL')
    placeholder.parent = editNode
    const placeholderTransform = placeholder.addComponent(UITransform)
    placeholderTransform.setContentSize(width - 50, height - 12)
    placeholderTransform.setAnchorPoint(0, 1)
    const placeholderLabel = placeholder.addComponent(Label)
    placeholderLabel.fontSize = Math.max(RUNTIME_MIN_TEXT_SIZE, resolvedInputFontSize - 2)
    placeholderLabel.lineHeight = resolvedInputFontSize + 4
    placeholderLabel.horizontalAlign = Label.HorizontalAlign.CENTER
    placeholderLabel.verticalAlign = Label.VerticalAlign.CENTER
    placeholderLabel.color = new Color(160, 180, 176)
    applyForegroundTextStyle(placeholderLabel, new Color(24, 37, 34, 255), 2)
    const edit = editNode.addComponent(EditBox)
    edit.maxLength = options.maxLength ?? 80
    edit.inputMode = options.inputMode ?? EditBox.InputMode.ANY
    edit.textLabel = textLabel
    edit.placeholderLabel = placeholderLabel
    edit.string = options.initialValue ?? ''
    edit.placeholder = placeholderText
    return edit
  }

}
