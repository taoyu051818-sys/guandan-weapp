// Explicit one-off import; never called at game startup. Stores no QQ metadata beyond nickname/avatar.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const directory = new URL('../server/data/default-profiles/', import.meta.url)
mkdirSync(directory, { recursive: true })
const catalogPath = new URL('catalog.json', directory)
const profiles = existsSync(catalogPath) ? JSON.parse(readFileSync(catalogPath)).profiles : []
const failures = []
for (let index = 0; index < 50; index++) {
  if (profiles.some(p => p.id === String(index + 1).padStart(3, '0'))) continue
  try {
    const qq = String(2952180056 + index)
    const response = JSON.parse(execFileSync('curl', ['--fail', '--silent', '--show-error', '--max-time', '20', `https://uapis.cn/api/v1/social/qq/userinfo?qq=${qq}`], { maxBuffer: 128 * 1024 }).toString())
    const displayName = Array.from(String(response.nickname || '').trim().replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '')).slice(0, 24).join('')
    if (!displayName) throw new Error('missing nickname')
    const avatar = new URL(response.avatar_url)
    if (avatar.hostname !== 'q.qlogo.cn' || avatar.pathname !== '/g' || avatar.searchParams.get('nk') !== qq) throw new Error('unexpected avatar host/identity')
    avatar.protocol = 'https:'
    avatar.searchParams.set('s', '100')
    const bytes = execFileSync('curl', ['--fail', '--silent', '--show-error', '--max-time', '20', avatar.href], { maxBuffer: 128 * 1024 })
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    const gif = /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())
    if (!jpeg && !png && !gif) throw new Error('invalid avatar image')
    const id = String(index + 1).padStart(3, '0')
    const file = `${id}.${jpeg ? 'jpg' : gif ? 'gif' : 'png'}`
    writeFileSync(new URL(file, directory), bytes)
    profiles.push({ id, displayName, avatarUrl: `profile:${id}`, file })
    console.log(`${index + 1}/50 imported`)
  } catch (error) {
    failures.push(index + 1); console.log(`${index + 1}/50 failed: ${error.message}`)
    if (String(error.stderr || error.message).includes('429')) { console.log('Rate limited; stop and resume later.'); break }
  }
  await new Promise(resolve => setTimeout(resolve, 6000))
}
profiles.sort((a, b) => a.id.localeCompare(b.id))
const missing = Array.from({ length: 50 }, (_, i) => i + 1).filter(i => !profiles.some(p => p.id === String(i).padStart(3, '0')))
writeFileSync(catalogPath, JSON.stringify({ version: 1, source: 'uapis.cn', profiles, failures: missing }, null, 2) + '\n')
console.log(JSON.stringify({ imported: profiles.length, failures }))
if (failures.length) process.exitCode = 1
