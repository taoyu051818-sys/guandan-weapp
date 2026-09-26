import { createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { promisify } from 'node:util'
import { assertPrivateAdminLocation } from './admin-config.js'

const derive = promisify(scrypt)
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const hashPattern = /^scrypt\$32768\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{128})$/
export const adminRoles = Object.freeze(['admin', 'operator', 'support'])
const validName = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,63}$/.test(value)

export function encodeBase32 (bytes) {
  let bits = 0; let value = 0; let output = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) { output += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits) output += alphabet[(value << (5 - bits)) & 31]
  return output
}

const decodeBase32 = input => {
  let bits = 0; let value = 0; const output = []
  for (const character of input) {
    value = (value << 5) | alphabet.indexOf(character)
    bits += 5
    if (bits >= 8) { output.push((value >>> (bits - 8)) & 255); bits -= 8 }
  }
  return Buffer.from(output)
}

export const totpAtStep = (secret, step) => {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest()
  const offset = digest[digest.length - 1] & 15
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0')
}

export const safeEqual = (left, right) => {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  const a = Buffer.from(left); const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

export const matchingTotpStep = (secret, token, now) => {
  if (typeof token !== 'string' || !/^\d{6}$/.test(token)) return null
  const current = Math.floor(now / 30_000)
  let matched = null
  for (const step of [current - 1, current, current + 1]) {
    if (step >= 0 && safeEqual(totpAtStep(secret, step), token)) matched = step
  }
  return matched
}

export async function hashAdminPassword (password) {
  if (typeof password !== 'string' || password.length < 6 || password.length > 256) throw new Error('Password must contain 6–256 characters')
  const salt = randomBytes(16).toString('hex')
  const key = await derive(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
  return `scrypt$32768$8$1$${salt}$${key.toString('hex')}`
}

export async function verifyAdminPassword (password, hash) {
  const match = hashPattern.exec(hash)
  if (!match || typeof password !== 'string' || password.length > 256) return false
  const key = await derive(password, match[1], 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
  return safeEqual(key.toString('hex'), match[2])
}

export async function createAdminCredential ({ username, password, role = 'admin' }) {
  if (!validName(username) || !adminRoles.includes(role)) throw new Error('Invalid admin username or role')
  return { id: randomUUID(), username, role, passwordHash: await hashAdminPassword(password), totpSecret: encodeBase32(randomBytes(20)), disabled: false }
}

export async function readAdminCredentials (file) {
  assertPrivateAdminLocation(await realpath(file))
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
  try {
    const stats = await handle.stat()
    if (!stats.isFile() || stats.size > 128 * 1024 || (process.platform !== 'win32' && (stats.mode & 0o077))) {
      throw new Error('ADMIN_CREDENTIALS_FILE must be a private regular file (0600), at most 128 KiB')
    }
    const data = JSON.parse(await handle.readFile('utf8'))
    if (data.schemaVersion !== 1 || !Array.isArray(data.admins) || data.admins.length < 1 || data.admins.length > 100) throw new Error('Invalid admin credential document')
    const ids = new Set(); const names = new Set()
    for (const admin of data.admins) {
      if (!admin || !validName(admin.username) || !adminRoles.includes(admin.role) || typeof admin.id !== 'string' || !/^[a-zA-Z0-9_-]{3,80}$/.test(admin.id) || !hashPattern.test(admin.passwordHash) || !/^[A-Z2-7]{32}$/.test(admin.totpSecret) || typeof admin.disabled !== 'boolean' || ids.has(admin.id) || names.has(admin.username)) {
        throw new Error('Invalid or duplicate admin credential')
      }
      ids.add(admin.id); names.add(admin.username)
    }
    return data.admins
  } finally { await handle.close() }
}
