import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { candidate02Layout, SHOP_BASE_SIZE, shopPresentation } from './candidate02.js'
assert.equal(SHOP_BASE_SIZE,70)
assert.equal(shopPresentation().size,70)
assert.equal(shopPresentation().fadeStart,shopPresentation().captionY-11+3)
assert.ok(shopPresentation().fadeStart<shopPresentation().fadeEnd)
const a={cardsX:0,cardsY:0,gapDelta:0,cardScale:1,quickX:0,quickY:0,titleY:0,shopScale:1}
for(const inset of [0,32]) {
  const l=candidate02Layout(a,inset,inset?8:0)
  assert.ok(l.classic.w*l.classic.h>l.friend.w*l.friend.h)
  assert.ok(l.friend.w*l.friend.h>l.tournament.w*l.tournament.h)
  assert.equal(l.friend.x+l.friend.w,l.quick.x+l.quick.w)
  assert.equal(l.classic.y+l.classic.h,l.tournament.y+l.tournament.h)
  assert.ok(l.classic.x+l.classic.w<l.friend.x)
  assert.ok(l.friend.y+l.friend.h<l.tournament.y)
  for(const r of Object.values(l)){assert.ok(r.x>=inset);assert.ok(r.x+r.w<=874-inset);assert.ok(r.y>=0&&r.y+r.h<=402)}
}
const original=candidate02Layout(a)
candidate02Layout({...a,cardsX:40,cardScale:1.1})
assert.deepEqual(candidate02Layout(a),original)
const app=await readFile(new URL('./app.js',import.meta.url),'utf8')
assert.match(app,/candidate2'\?':candidate2':''/, 'separate local storage keys')
assert.match(app,/button.hidden = !regions.some/, 'old hit areas must not survive variant switching')
assert.match(app, /import \{ drawUiFrame \} from '\/shared\/UiFrameStyle.js'/)
assert.match(app, /drawCandidate02\(\{ ctx, images, panel: framePanel/, 'current candidate shares the runtime theme')
assert.match(app, /function panel[\s\S]*ctx\.roundRect/, 'historical baseline keeps its own reference drawing')
const flows=await readFile(new URL('./flows.js',import.meta.url),'utf8')
const drawing=await readFile(new URL('./candidate02.js',import.meta.url),'utf8')
assert.ok(drawing.includes("label('商城',sx,sy+size*.34,15.4,size-12,'#ffe269','#3a2311',1.89)"), 'shop caption and outline must scale to 70%, without resizing the chick')
assert.ok(drawing.includes("panel(94 + inset, 35, 180, 58, '#102c3d66', '', 'tag', 0)"), 'backing must be 180px wide while its left edge stays at 4px')
assert.ok(drawing.indexOf('panel(94 + inset') < drawing.indexOf("image('avatar'"), 'backing must render behind account content')
assert.doesNotMatch(drawing,/玩法说明|设置/, 'retired lobby buttons must not be drawn or registered')
assert.doesNotMatch(flows,/id==='settings'|rules:\[|男声/, 'retired mock flows must not remain reachable')
assert.doesNotMatch(flows,/fetch\(|XMLHttpRequest|WebSocket|setInterval|setTimeout/)
assert.doesNotMatch(flows,/人机测试|延迟观战|牌桌特效测试/)
console.log('Candidate 02: hierarchy, spacing, safe bounds, independent drafts and mock-only flows passed')
