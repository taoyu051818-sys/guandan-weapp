import { createHash, randomInt } from 'node:crypto'
import { readFileSync } from 'node:fs'

const directory = new URL('./data/default-profiles/', import.meta.url)
const catalog = JSON.parse(readFileSync(new URL('catalog.json', directory), 'utf8'))
export const DEFAULT_PROFILES = Object.freeze(catalog.profiles.map(p => Object.freeze(p)))
if (!DEFAULT_PROFILES.length || DEFAULT_PROFILES.some(p => !/^\d{3}$/.test(p.id) || !/^\d{3}\.(jpg|png|gif)$/.test(p.file)
  || p.avatarUrl !== `profile:${p.id}` || !p.displayName || [...p.displayName].length > 24)) throw new Error('Invalid default profile catalog')

export const randomDefaultProfile = () => DEFAULT_PROFILES[randomInt(DEFAULT_PROFILES.length)]
export const stableDefaultProfile = (identity, attempt = 0) => DEFAULT_PROFILES[
  (createHash('sha256').update(`profile-v1:${identity}`).digest().readUInt32BE(0) + Math.max(0, Math.trunc(attempt))) % DEFAULT_PROFILES.length]
export const isDefaultAvatar = value => DEFAULT_PROFILES.some(p => p.avatarUrl === value)
export const defaultAvatarImage = value => {
  const profile = DEFAULT_PROFILES.find(p => p.avatarUrl === value)
  if (!profile) return null
  const mime = profile.file.endsWith('.jpg') ? 'jpeg' : profile.file.endsWith('.gif') ? 'gif' : 'png'
  return `data:image/${mime};base64,${readFileSync(new URL(profile.file, directory)).toString('base64')}`
}
