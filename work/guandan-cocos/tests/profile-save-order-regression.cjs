const assert = require('node:assert/strict')
const path = require('node:path')
const { loadTs } = require('./support/load-typescript-module.cjs')
const root = path.resolve(__dirname, '../assets/scripts')
const { ProfileSaveCoordinator } = loadTs(path.join(root, 'services/ProfileSaveCoordinator.ts'))
const { ProfileEditorModal } = loadTs(path.join(root, 'scenes/front-pages/ProfileEditorModal.ts'), {
  cc: { game: { on () {}, off () {} }, Game: { EVENT_HIDE: 'hide' } },
  '../../services/ProfileSaveCoordinator': { ProfileSaveCoordinator },
  '../../services/WechatProfileProvider': {}, '../../ui/ProfileAvatar': {}, '../../ui/RuntimeUiFactory': {},
})
const flush = () => new Promise(resolve => setImmediate(resolve))
const initial = () => ({ id: 'user-a', accountId: 'account-a', displayName: 'original', avatarUrl: '', comprehensiveScore: 300 })
const harness = () => {
  let stored = initial(), failRead = false
  const writes = [], published = []
  const auth = {
    getProfile: async () => { if (failRead) throw new Error('offline'); return { ...stored } },
    updateProfile: change => new Promise((resolve, reject) => {
      writes.push({ change, resolve: () => { stored = { ...stored, ...change }; resolve({ ...stored }) }, reject })
    }),
  }
  const editor = new ProfileEditorModal({}, {}, auth, p => published.push(p))
  // The real show/close/save methods run; rendering alone is replaced by inert Cocos node doubles.
  editor.render = function () {
    this.root = { isValid: true, destroy () { this.isValid = false } }
    this.input = { string: this.draft?.displayName ?? '' }; this.status = { string: '' }
  }
  const open = async name => { await editor.show({ ...stored }); editor.input.string = name }
  return { editor, open, writes, published, auth, get stored () { return stored },
    switchAccount: () => { stored = { ...initial(), id: 'user-b', accountId: 'account-b' } },
    failRead: value => { failRead = value } }
}

async function main () {
  {
    const h = harness(); await h.open('closed-save')
    const save = h.editor.save(); await flush(); h.editor.close(); h.writes[0].resolve(); await save
    assert.equal(h.published[0].displayName, 'closed-save', 'closing alone must not lose a committed save')
    assert.equal(h.editor.open, false)
  }
  {
    const h = harness(); await h.open('older-name')
    const a = h.editor.save(); await flush(); h.editor.close(); await h.open('newer-name')
    const b = h.editor.save(); await flush()
    assert.equal(h.writes.length, 1, 'newer writes wait: server responses cannot reorder commits')
    h.writes[0].resolve(); await a; await flush()
    assert.deepEqual(h.published, [], 'superseded response cannot flash the old name into shared UI state')
    assert.equal(h.editor.open, true); assert.equal(h.editor.busy, true, 'old finally cannot unlock the new save')
    assert.equal(h.writes.length, 2); h.writes[1].resolve(); await b
    assert.deepEqual(h.published.map(p => p.displayName), ['newer-name'])
    assert.equal(h.stored.displayName, 'newer-name'); assert.equal(h.editor.open, false)
  }
  {
    const h = harness(); await h.open('first-committed')
    const a = h.editor.save(); await flush(); h.editor.close(); await h.open('failed-draft')
    const b = h.editor.save(); h.writes[0].resolve(); await a; await flush()
    h.writes[1].reject(new Error('save rejected')); await b
    assert.equal(h.published.at(-1).displayName, 'first-committed', 'failed latest save reconciles the actual server result')
    assert.equal(h.editor.open, true); assert.equal(h.editor.busy, false)
    assert.equal(h.editor.status.string, 'save rejected')
  }
  {
    const h = harness(); await h.open('failed-earlier')
    const a = h.editor.save(); await flush(); h.editor.close(); await h.open('success-after-failure')
    const b = h.editor.save(); h.writes[0].reject(new Error('old failure')); await a; await flush()
    assert.equal(h.editor.busy, true); assert.notEqual(h.editor.status.string, 'old failure')
    h.writes[1].resolve(); await b; assert.equal(h.published.at(-1).displayName, 'success-after-failure')
  }
  {
    const h = harness(); const queue = new ProfileSaveCoordinator(h.auth, p => h.published.push(p))
    const change = { displayName: 'snapshot' }, save = queue.save(change, 'user-a')
    change.displayName = 'mutated-after-submit'; await flush(); assert.equal(h.writes[0].change.displayName, 'snapshot')
    h.writes[0].resolve(); await save
    h.failRead(true); await assert.rejects(queue.save({ displayName: 'offline' }, 'user-a'), /offline/)
    assert.equal(h.published.at(-1).displayName, 'snapshot'); assert.equal(h.writes.length, 1)
    h.failRead(false)
    const next = queue.save({ displayName: 'recovered' }, 'user-a'); await flush(); h.writes[1].resolve(); await next
    assert.equal(h.published.at(-1).displayName, 'recovered', 'failed queue entries cannot poison subsequent saves')
  }
  {
    const h = harness(); const queue = new ProfileSaveCoordinator(h.auth, p => h.published.push(p))
    const a = queue.save({ displayName: 'old-account' }, 'user-a'); await flush()
    const b = queue.save({ displayName: 'must-not-leak' }, 'user-a')
    const rejected = assert.rejects(b, /账号已切换/)
    h.writes[0].resolve(); h.switchAccount(); await a; await rejected
    assert.equal(h.writes.length, 1, 'queued save must not mutate a newly logged-in account')
    assert.deepEqual(h.published, [])
  }
  console.log('profile modal lifetime, ordered saves, failure reconciliation and account isolation passed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
