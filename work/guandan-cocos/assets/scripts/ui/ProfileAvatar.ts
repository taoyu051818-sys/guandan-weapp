import { Node, Sprite, UITransform, Vec3 } from 'cc'
import type { AuthGateway, UserProfile } from '../services/FrontPageGatewayContracts'
import { acquireProfileAvatarFrame } from '../services/ProfileAvatarAssets'

export function mountProfileAvatar (parent: Node, profile: UserProfile | null | undefined, auth: AuthGateway,
  x: number, y: number, size: number): Node {
  const node = new Node('ProfileAvatar')
  node.parent = parent
  node.setPosition(new Vec3(x, y, 0))
  node.addComponent(UITransform).setContentSize(size, size)
  const sprite = node.addComponent(Sprite)
  sprite.sizeMode = Sprite.SizeMode.CUSTOM
  let lease = acquireProfileAvatarFrame(profile, auth)
  node.on(Node.EventType.NODE_DESTROYED, () => { if (sprite.isValid) sprite.spriteFrame = null; lease.release() })
  void lease.ready.then(frame => {
    if (!node.isValid) return
    if (frame) sprite.spriteFrame = frame
    else {
      lease.release()
      lease = acquireProfileAvatarFrame(null, auth)
      void lease.ready.then(fallback => { if (node.isValid) sprite.spriteFrame = fallback })
    }
  })
  return node
}
