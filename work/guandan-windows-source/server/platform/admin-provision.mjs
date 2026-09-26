import { open, mkdir, lstat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'
import { createAdminCredential } from './admin-credentials.js'

// Offline only. Never accepts a password as an argument or prints enrollment secrets.
export async function provisionAdminFiles ({ file, enrollmentFile, username, password, role = 'admin' }) {
  const credentialPath = resolve(file); const enrollmentPath = resolve(enrollmentFile)
  if (credentialPath === enrollmentPath) throw new Error('Credential and enrollment files must be different')
  for (const target of [credentialPath, enrollmentPath]) {
    try { await lstat(target); throw new Error(`Refusing to overwrite existing file: ${target}`) } catch (error) { if (error.code !== 'ENOENT') throw error }
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
  }
  const admin = await createAdminCredential({ username, password, role })
  const enrollment = {
    username, issuer: 'Guandan Admin', totpSecret: admin.totpSecret,
    uri: `otpauth://totp/${encodeURIComponent(`Guandan Admin:${username}`)}?secret=${admin.totpSecret}&issuer=Guandan%20Admin&algorithm=SHA1&digits=6&period=30`,
  }
  for (const [target, document] of [[credentialPath, { schemaVersion: 1, admins: [admin] }], [enrollmentPath, enrollment]]) {
    const handle = await open(target, 'wx', 0o600)
    try { await handle.chmod(0o600); await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`); await handle.sync() } finally { await handle.close() }
  }
  return { credentialPath, enrollmentPath }
}

const hiddenPassword = prompt => new Promise((resolvePassword, reject) => {
  const silent = new Writable({ write (_chunk, _encoding, callback) { callback() } })
  const input = createInterface({ input: process.stdin, output: silent, terminal: true })
  process.stderr.write(prompt)
  input.once('SIGINT', () => { input.close(); process.stderr.write('\n'); reject(new Error('Provisioning cancelled')) })
  input.question('', answer => { input.close(); process.stderr.write('\n'); resolvePassword(answer) })
})

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {}
    const args = process.argv.slice(2)
    for (let index = 0; index < args.length; index += 2) {
      const key = args[index]; const value = args[index + 1]
      if (!['--file', '--enrollment-file', '--username', '--role'].includes(key) || !value || value.startsWith('--') || options[key]) throw new Error('Usage: node server/platform/admin-provision.mjs --file /private/admins.json --enrollment-file /private/enrollment.json --username NAME [--role admin|operator|support]')
      options[key] = value
    }
    if (!options['--file'] || !options['--enrollment-file'] || !options['--username'] || !process.stdin.isTTY) throw new Error('Provisioning requires a terminal and --file, --enrollment-file, --username. Passwords must not be passed through argv or environment variables.')
    const password = await hiddenPassword('New admin password (6–256 characters; no character-type requirements): ')
    if (await hiddenPassword('Confirm password: ') !== password) throw new Error('Passwords do not match')
    const result = await provisionAdminFiles({ file: options['--file'], enrollmentFile: options['--enrollment-file'], username: options['--username'], role: options['--role'] || 'admin', password })
    process.stdout.write(`Created private credential file: ${result.credentialPath}\nCreated private enrollment file: ${result.enrollmentPath}\nImport the enrollment URI into an authenticator using a secure local channel; remove the enrollment file after enrollment. Never commit either file.\n`)
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1 }
}
