import { cp, mkdir, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

const tsc = '../../shared-core/../work/guandan-weapp/node_modules/.bin/tsc'
const compiled = spawnSync(tsc, ['-p', '../../shared-core/tsconfig.json'], { stdio: 'inherit' })
if (compiled.status !== 0) process.exit(compiled.status ?? 1)
await rm('dist', { recursive: true, force: true })
await mkdir('dist', { recursive: true })
await cp('native', 'dist', { recursive: true })
// 音频资源体积远超微信主包 2MB 限制。真机从 HTTPS 音频 CDN 按需加载，不能打进主包。
await rm('dist/assets', { recursive: true, force: true })
await cp('../../shared-core/dist', 'dist/core', { recursive: true })
console.log('微信小程序产物已生成：dist')
