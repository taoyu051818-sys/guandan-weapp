/** Candidate-only design pixels. Not connected to the live Cocos layout. */
export const SHOP_BASE_SIZE = 70
export function shopPresentation(scale = 1) {
  const size = SHOP_BASE_SIZE * scale
  const captionY = size * .84
  // Preserve the chick's original fade boundary when resizing its caption.
  return { size, captionY, fadeStart: captionY - 11 + 3, fadeEnd: size }
}
const shopMasks = new WeakMap()
function shopWithFade(source, size) {
  let cached = shopMasks.get(source)
  if (cached?.size === size) return cached.canvas
  const mask = document.createElement('canvas'); mask.width=source.width; mask.height=source.height
  const c=mask.getContext('2d'), start=shopPresentation(size/SHOP_BASE_SIZE).fadeStart/size
  c.drawImage(source,0,0)
  const fade=c.createLinearGradient(0,0,0,mask.height)
  fade.addColorStop(0,'rgba(0,0,0,1)');fade.addColorStop(start,'rgba(0,0,0,1)');fade.addColorStop(1,'rgba(0,0,0,0)')
  c.globalCompositeOperation='destination-in';c.fillStyle=fade;c.fillRect(0,0,mask.width,mask.height)
  shopMasks.set(source,{size,canvas:mask});return mask
}
export function candidate02Layout(a, inset = 0, bottom = 0) {
  const scale = 874 / 1280, zoom = a.cardScale
  const x = a.cardsX * scale - inset, y = -a.cardsY * scale
  const gap = a.gapDelta * scale
  const rect = (left, top, width, height) => ({ x: 642 + (left - 642) * zoom + x, y: 201 + (top - 201) * zoom + y, w: width * zoom, h: height * zoom })
  return {
    classic: rect(448 - gap / 2, 90, 184, 222),
    friend: rect(646 + gap / 2, 90, 188, 142),
    tournament: rect(646 + gap / 2, 244, 188, 68),
    quick: { x: 624 + a.quickX * scale - inset, y: 338 - a.quickY * scale - bottom, w: 210, h: 46 },
  }
}

export function drawCandidate02(api, a, inset, bottom, state) {
  const { ctx, images, panel, label, image, region } = api
  const layout = candidate02Layout(a, inset, bottom)
  const mark = (id, name, r, disabled = false) => region(id, name, r.x + r.w / 2, r.y + r.h / 2, r.w, r.h, 'control', disabled)
  const text = (t,x,y,size,width,color='#223c51') => label(t,x,y,size,width,color,'#fff8df',0,true)
  // Source images contain their old captions. Crop only the illustration and redraw live copy.
  const art = (key, x, y, w, h) => {
    const img = images[key], sh = img.height * .74
    const cover = Math.max(w / img.width, h / sh), sw = w / cover, cropH = h / cover
    ctx.drawImage(img, (img.width - sw) / 2, (sh - cropH) / 2, sw, cropH, x, y, w, h)
  }
  const name = state === 'long' ? '陵水海岸的快乐掼蛋玩家' : '陵水玩家'
  // One shared translucent backing, not separate nickname/points capsules.
  // Decorative only: preserve the existing positions and hit targets.
  panel(94 + inset, 35, 180, 58, '#102c3d66', '', 5, 0)
  panel(32 + inset, 35, 44, 44, '#132f35ba', '#fae9b4', 6, 1)
  image('avatar', 32 + inset,35,40,40)
  // No pill backgrounds: name and points form two simple left-aligned rows.
  const shownName = [...name].length > 5 ? [...name].slice(0,4).join('')+'…' : name
  ctx.save();ctx.textAlign='left';ctx.textBaseline='middle';ctx.lineJoin='round'
  ctx.font='600 17px Arial, "PingFang SC", sans-serif';ctx.strokeStyle='#263b35';ctx.lineWidth=2
  ctx.strokeText(shownName,63+inset,25);ctx.fillStyle='#fff4d3';ctx.fillText(shownName,63+inset,25)
  image('coin',71+inset,48,17,18)
  ctx.font='15px Arial, "PingFang SC", sans-serif';const points=state==='long'?'123456789':'10000'
  ctx.strokeText(points,87+inset,48,69);ctx.fillStyle='#ffe9a1';ctx.fillText(points,87+inset,48,69);ctx.restore()
  region('avatar','个人头像',32+inset,35,44,44)
  region('identity','个人资料',148+inset,25,174,28)
  region('points','积分信息',118+inset,48,114,20,'information')
  for (const key of ['classic','friend']) {
    const r = layout[key], footer = key === 'classic' ? 54*a.cardScale : 48*a.cardScale
    panel(r.x+r.w/2,r.y+r.h/2,r.w,r.h,'#fffbed','#ead69b',6,2)
    ctx.save(); ctx.beginPath(); ctx.roundRect(r.x+2,r.y+2,r.w-4,r.h-4,4); ctx.clip()
    art(key,r.x+2,r.y+2,r.w-4,r.h-footer-2); ctx.restore()
    text(key === 'classic' ? '经典掼蛋' : '好友房',r.x+r.w/2,r.y+r.h-footer+18*a.cardScale,24*a.cardScale,r.w-16)
    label(key === 'classic' ? '随机级牌 · 单局对战' : '创建房间 / 加入房间',r.x+r.w/2,r.y+r.h-13*a.cardScale,12*a.cardScale,r.w-16,'#5d716f','',0,false)
    mark(key,key === 'classic' ? '经典掼蛋' : '好友房',r)
  }
  const t = layout.tournament
  panel(t.x+t.w/2,t.y+t.h/2,t.w,t.h,'#eaf1ecf5','#becfc7',6,1)
  ctx.save(); ctx.beginPath(); ctx.roundRect(t.x+t.w-66*a.cardScale,t.y+5,61*a.cardScale,t.h-10,5);ctx.clip()
  art('tournament',t.x+t.w-66*a.cardScale,t.y+5,61*a.cardScale,t.h-10);ctx.restore()
  text('赛事',t.x+40*a.cardScale,t.y+25*a.cardScale,21*a.cardScale,70*a.cardScale)
  label('筹备中',t.x+42*a.cardScale,t.y+47*a.cardScale,12*a.cardScale,75*a.cardScale,'#596e73','',0,false)
  mark('tournament','赛事（筹备中）',t)
  const {size} = shopPresentation(a.shopScale), sx = 18+inset+size/2, sy = 386-bottom-size/2
  ctx.drawImage(shopWithFade(images.shop,size),sx-size/2,sy-size/2,size,size)
  // Draw text after the masked image: it remains fully opaque.
  label('商城',sx,sy+size*.34,15.4,size-12,'#ffe269','#3a2311',1.89)
  region('shop','商城',sx,sy,size,size)
  const q=layout.quick, busy=state==='loading'
  const title=busy?'正在恢复':state==='resume'?'继续牌局':'快速开始'
  const subtitle=busy?'正在确认牌局状态':state==='resume'?'返回尚未结束的牌局':'随机级牌 · 单局对战'
  panel(q.x+q.w/2,q.y+q.h/2,q.w,q.h,'#efbb4f','#fff0b9',7,2)
  panel(q.x+q.w/2,q.y+q.h/2,q.w-7,q.h-7,'','#b1864166',5,1)
  text(title,q.x+q.w/2,q.y+16,23,q.w-16,'#65421c')
  label(subtitle,q.x+q.w/2,q.y+34,12,q.w-16,'#694f2d','',0,false)
  mark('quick',title,q,busy)
  return layout
}
