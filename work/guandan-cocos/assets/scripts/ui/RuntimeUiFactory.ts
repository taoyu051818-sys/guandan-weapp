import { Color, EditBox, Graphics, Label, Node, Sprite, SpriteFrame, Texture2D, UIOpacity, UITransform, Vec3, tween } from 'cc'
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
  radius?: number
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

/** Keeps runtime text legible over illustrated tables without adding wrapper cards. */
export const applyForegroundTextStyle = (
  label: Label,
  outlineColor = new Color(27, 37, 34, 255),
  outlineWidth = 2,
): Label => {
  label.enableOutline = true
  label.outlineColor = outlineColor
  label.outlineWidth = Math.max(1, outlineWidth)
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
    const node = new Node(name)
    node.parent = this.root
    node.setPosition(new Vec3(x, y, 0))
    node.addComponent(UITransform).setContentSize(1100, 80)
    const label = node.addComponent(Label)
    label.fontSize = fontSize
    label.lineHeight = fontSize + 8
    label.color = new Color(245, 239, 215)
    label.horizontalAlign = Label.HorizontalAlign.CENTER
    return applyForegroundTextStyle(label)
  }

  public menuLabel (text: string, x: number, y: number, fontSize: number): Label {
    const lines = text.split('\n')
    const lineWidth = (line: string): number => Array.from(line).reduce(
      (width, character) => width + (/^[\u0000-\u00ff]$/.test(character) ? fontSize * 0.58 : fontSize),
      0,
    )
    const rootWidth = this.root.getComponent(UITransform)?.contentSize.width ?? 1280
    const maxWidth = Math.max(220, rootWidth - 64)
    const width = text.length
      ? Math.min(maxWidth, Math.max(120, Math.ceil(Math.max(...lines.map(lineWidth)) + 34)))
      : Math.min(760, maxWidth)
    const height = Math.max(fontSize + 18, lines.length * (fontSize + 7) + 14)
    const container = new Node('MenuLabelBacking')
    container.parent = this.root
    container.setPosition(new Vec3(x, y - 10, 0))
    container.addComponent(UITransform).setContentSize(width, height)
    const graphics = container.addComponent(Graphics)
    graphics.fillColor = new Color(4, 9, 10, 158)
    graphics.roundRect(-width / 2, -height / 2, width, height, Math.min(height / 2, 18))
    graphics.fill()

    const textNode = new Node('MenuLabel')
    textNode.parent = container
    textNode.addComponent(UITransform).setContentSize(width - 22, height - 8)
    const label = textNode.addComponent(Label)
    label.string = text
    label.fontSize = fontSize
    label.lineHeight = fontSize + 7
    label.overflow = Label.Overflow.SHRINK
    label.enableWrapText = true
    label.horizontalAlign = Label.HorizontalAlign.CENTER
    label.verticalAlign = Label.VerticalAlign.CENTER
    label.color = new Color(218, 179, 79)
    label.isBold = true
    label.enableOutline = true
    label.outlineColor = new Color(38, 26, 17, 255)
    label.outlineWidth = fontSize >= 28 ? 3 : 2
    const opacity = container.addComponent(UIOpacity)
    opacity.opacity = 0
    tween(opacity).to(0.2, { opacity: 255 }).start()
    tween(container).to(0.22, { position: new Vec3(x, y, 0) }, { easing: 'quadOut' }).start()
    return label
  }

  public outlinedLabel (text: string, x: number, y: number, fontSize: number, style: RuntimeLabelStyle = {}): Label {
    const node = new Node('OutlinedLabel')
    node.parent = style.parent ?? this.root
    node.setPosition(new Vec3(x, y, 0))
    node.addComponent(UITransform).setContentSize(style.width ?? 500, style.height ?? Math.max(54, fontSize + 16))
    const label = node.addComponent(Label)
    label.string = text
    label.fontSize = fontSize
    label.lineHeight = fontSize + 6
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
    graphics.roundRect(-width / 2, -height / 2, width, height, style.radius ?? 8)
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
      radius: 8,
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
      graphics.roundRect(-halfWidth, -halfHeight, width, height, style.radius ?? Math.min(16, halfHeight / 2))
      graphics.fill()
      if ((style.lineWidth ?? 2) > 0) graphics.stroke()
    }
    draw(false)

    const textNode = new Node('ButtonText')
    textNode.parent = node
    textNode.addComponent(UITransform).setContentSize(width - 14, height - 6)
    const label = textNode.addComponent(Label)
    label.fontSize = fontSize
    label.lineHeight = fontSize + 5
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

  public quickChatButton (text: string, x: number, y: number): Node {
    const node = new Node('QuickChat')
    node.parent = this.root
    node.setPosition(new Vec3(x, y, 0))
    node.addComponent(UITransform).setContentSize(380, 42)
    const graphics = node.addComponent(Graphics)
    graphics.fillColor = new Color(20, 42, 39, 245)
    graphics.strokeColor = new Color(188, 143, 57, 220)
    graphics.lineWidth = 1
    graphics.roundRect(-190, -21, 380, 42, 12)
    graphics.fill()
    graphics.stroke()
    const textNode = new Node('QuickChatText')
    textNode.parent = node
    textNode.addComponent(UITransform).setContentSize(360, 38)
    const label = textNode.addComponent(Label)
    label.fontSize = 17
    label.lineHeight = 23
    label.horizontalAlign = Label.HorizontalAlign.CENTER
    label.verticalAlign = Label.VerticalAlign.CENTER
    label.string = text
    label.color = new Color(245, 239, 215)
    applyForegroundTextStyle(label, new Color(24, 37, 34, 255), 2)
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
    graphics.roundRect(-width / 2, -height / 2, width, height, 12)
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
    const textLabel = inputText.addComponent(Label)
    textLabel.fontSize = options.fontSize ?? 22
    textLabel.lineHeight = (options.fontSize ?? 22) + 6
    textLabel.horizontalAlign = Label.HorizontalAlign.CENTER
    textLabel.verticalAlign = Label.VerticalAlign.CENTER
    textLabel.color = new Color(245, 239, 215)
    textLabel.string = ''
    const placeholder = new Node('PLACEHOLDER_LABEL')
    placeholder.parent = editNode
    const placeholderTransform = placeholder.addComponent(UITransform)
    placeholderTransform.setContentSize(width - 50, height - 12)
    placeholderTransform.setAnchorPoint(0, 1)
    const placeholderLabel = placeholder.addComponent(Label)
    placeholderLabel.fontSize = Math.max(14, (options.fontSize ?? 22) - 2)
    placeholderLabel.lineHeight = (options.fontSize ?? 22) + 4
    placeholderLabel.horizontalAlign = Label.HorizontalAlign.CENTER
    placeholderLabel.verticalAlign = Label.VerticalAlign.CENTER
    placeholderLabel.color = new Color(160, 180, 176)
    const edit = editNode.addComponent(EditBox)
    edit.maxLength = options.maxLength ?? 80
    edit.inputMode = options.inputMode ?? EditBox.InputMode.ANY
    edit.textLabel = textLabel
    edit.placeholderLabel = placeholderLabel
    edit.string = options.initialValue ?? ''
    edit.placeholder = placeholderText
    return edit
  }

  public roomCodeInput (x: number, y: number): Node {
    const edit = this.formInput('RoomCodeInput', '输入六位房间号', x, y, {
      maxLength: 6,
      inputMode: EditBox.InputMode.NUMERIC,
    })
    return edit.node.parent ?? edit.node
  }
}
