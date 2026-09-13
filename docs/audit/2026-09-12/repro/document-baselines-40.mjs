// Audit-only, read-only: documentation drift checks against inspected runtime sources.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..')
const read=p=>fs.readFileSync(resolve(root,p),'utf8')
const report=JSON.parse(read('docs/audit/2026-09-12/batches/document-baselines-40.json'))
for(const item of report.boundaryReviewed) {
  const bytes=fs.readFileSync(resolve(root,item.path))
  assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256,item.path)
}
const cocos='work/guandan-cocos/', server='work/guandan-windows-source/server/'
assert.match(read(cocos+'README.md'),/开发构建的「固定牌局 · 音效\/动效实验室」提供/)
assert.match(read(cocos+'README.md'),/赛事按钮目前只提示“筹备中”/)
assert.match(read(cocos+'assets/scripts/scenes/FrontPageController.ts'),/showTournament: \(\) => this\.tournamentPage\.open\(\)/)
assert.match(read(cocos+'assets/scripts/scenes/front-pages/TournamentCenterController.ts'),/api\.enroll/)
for(const name of ['quick-chat','fixed-match-fixtures','merchant-console']) assert.ok(fs.existsSync(resolve(root,cocos+'tests/'+name+'-regression.cjs')))
assert.match(read(cocos+'tests/quick-chat-regression.cjs'),/existsSync[\s\S]*false/)
assert.match(read(cocos+'tests/fixed-match-fixtures-regression.cjs'),/fixtures\/FixedMatchFixtures/)
assert.match(read(cocos+'tests/merchant-console-regression.cjs'),/migration\/merchant/)
assert.match(read(cocos+'docs/RELEASE_ACCEPTANCE_20260910.md'),/0\.5–1\.5 秒/)
const { decisionDelayMs }=await import(pathToFileURL(resolve(root,server+'bot-turn-pacing.js')))
assert.deepEqual([decisionDelayMs(0,()=>.1),decisionDelayMs(60,()=>.1),decisionDelayMs(60,()=>.099)],[500,3000,9000])
assert.match(read(server+'platform/README.md'),/客户端分享\/复制时必须传递完整/)
assert.ok(!read(server+'platform/README.md').includes('join-by-number'))
assert.match(read(server+'platform/http.js'),/\/api\/v1\/friend-rooms\/join-by-number/)
assert.match(read(server+'platform/friend-room-service.js'),/async joinByNumber[\s\S]*this\.admit\(userId, input, true\)/)
assert.match(read(cocos+'assets/scripts/services/platform/friendRoomGateway.ts'),/\/api\/v1\/friend-rooms\/join-by-number/)
for(const name of ['ARRANGEMENT_INCREMENTAL','HAND_ARRANGEMENT','HAND_LAYOUT_SNAPSHOTS','NO_SHUFFLE_SIX_GROUPS']) {
  const doc=read('docs/'+name+'_20260910.md')
  assert.match(doc.slice(0,350),/退役/)
  assert.ok(doc.includes('SIMPLE_ARRANGEMENT_RESTORE_20260910.md'))
}
assert.match(read('docs/SIMPLE_ARRANGEMENT_RESTORE_20260910.md'),/普通顺子不自动生成/)
assert.match(read(cocos+'assets/scripts/effects/NetworkEffectSyncPolicy.ts'),/mode: 'incremental'/)
const pages=Array.from({length:8},(_,i)=> {
  const p='docs/audit/2026-09-12/evidence/docx-40/page-'+(i+1)+'.png'
  const b=fs.readFileSync(resolve(root,p))
  assert.equal(b.subarray(1,4).toString(),'PNG')
  return {page:i+1,sha256:createHash('sha256').update(b).digest('hex'),bytes:b.length}
})
console.log(JSON.stringify({documentHashes:report.boundaryReviewed.length,driftExtensions:['obsolete-lab-and-tournament-copy','old-pacing-acceptance','missing-number-join-guide'],retainedTestsAreNotMissing:3,retiredPlanningNotices:4,delayMs:[500,3000,9000],docxPages:pages,productWrites:0},null,2))
