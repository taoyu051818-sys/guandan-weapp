// Audit-only read checks. Does not build, modify, stage or contact a service.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..')
const audit=resolve(root,'docs/audit/2026-09-12')
const hash=p=>createHash('sha256').update(fs.readFileSync(resolve(root,p))).digest('hex')
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trimEnd()
const expected={
  'shared-core/tests/rules-regression.cjs':'d22830d6a63322d3e350bf742e0284077456f53bafabc981870373398901162a',
  'work/guandan-cocos/assets/scripts/scenes/GameScene.ts':'2d63afd01e269023057b578c322b8243af9a2be2a422aac76deb83758df9cd2c',
  'work/guandan-cocos/assets/scripts/scenes/TablePhasePresenter.ts':'e299058b7fa22bf6194124fb8a9fa4d76947415737ebcecda34174e4f94dc907',
  'work/guandan-cocos/docs/RELEASE_ACCEPTANCE_20260910.md':'398f68eac5ee287be423fd063b57ec04158ad2b6320fad351d9683447a8419bd',
  'work/guandan-cocos/tests/table-phase-presenter-regression.cjs':'fa7d8df4716e8c4e12bd4ac3c985863c31de96df7a6a587c0b16c6c94b256fa3',
}
assert.equal(git('rev-parse','HEAD'),'1d58999dc6e5455b049e1643660bbba3deee1406')
for(const [path,value] of Object.entries(expected))assert.equal(hash(path),value,path)
assert.deepEqual(git('diff','--name-only').split('\n').filter(p=>p&&!p.startsWith('docs/audit/')).sort(),Object.keys(expected).sort())
assert.deepEqual(git('ls-files','--others','--exclude-standard').split('\n').filter(p=>p&&!p.startsWith('docs/audit/')),[])
const reviewed=new Set(),issues=new Set(),boundaries=new Set()
for(const name of fs.readdirSync(resolve(audit,'batches')).filter(p=>p.endsWith('.json'))){
  const report=JSON.parse(fs.readFileSync(resolve(audit,'batches',name)))
  for(const entry of report.reviewed||[]){
    assert.ok(!reviewed.has(entry.path),'duplicate review '+entry.path)
    assert.equal(hash(entry.path),entry.sha256,entry.path);reviewed.add(entry.path)
  }
  for(const entry of report.boundaryReviewed||[]){
    assert.ok(!boundaries.has(entry.path),'duplicate boundary '+entry.path)
    assert.ok(entry.category?.endsWith('-boundary')&&entry.group,'missing boundary scope '+entry.path)
    assert.equal(hash(entry.path),entry.sha256,entry.path);boundaries.add(entry.path)
  }
  for(const finding of report.findings||[]){
    assert.ok(finding.id&&!issues.has(finding.id),'missing/duplicate issue '+finding.id);issues.add(finding.id)
  }
}
const coverage=JSON.parse(fs.readFileSync(resolve(audit,'coverage.json')))
assert.equal(coverage.reviewedFirstParty,reviewed.size)
assert.ok([...boundaries].every(p=>!reviewed.has(p)),'boundary must not inflate manual source coverage')
assert.equal(Object.values(coverage.boundaryCoverage??{}).reduce((sum,item)=>sum+item.checked,0),boundaries.size)
const inventory=execFileSync(process.execPath,[resolve(audit,'inventory.mjs'),'--check'],{cwd:root,encoding:'utf8'}).trim()
git('diff','--check')
console.log(JSON.stringify({headUnchanged:true,originalDirtyHashes:5,reviewedHashes:reviewed.size,boundaryHashes:boundaries.size,uniqueIssues:issues.size,firstParty:coverage.reviewedFirstParty+'/'+coverage.totalFirstParty,percent:coverage.percent,generatedCopies:coverage.generatedVerified,boundaryCoverage:coverage.boundaryCoverage,inventory,gitDiffCheck:'passed'},null,2))
