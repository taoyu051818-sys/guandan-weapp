import {
  chmodSync,
  closeSync,
  constants,
  fchmodSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import {
  chmod,
  mkdir,
  open,
  rename,
  rm,
} from 'node:fs/promises'
import { dirname } from 'node:path'

let temporarySequence = 0

const temporaryPathFor = filePath => {
  temporarySequence += 1
  return `${filePath}.${process.pid}.${Date.now()}.${temporarySequence}.tmp`
}

const ignoreMissing = error => {
  if (error?.code !== 'ENOENT') throw error
}

export const nodeSyncDurableFileOperations = Object.freeze({
  ensurePrivateDirectory (directoryPath) {
    mkdirSync(directoryPath, { recursive: true, mode: 0o700 })
    chmodSync(directoryPath, 0o700)
  },
  hardenExistingFile (filePath) {
    try { chmodSync(filePath, 0o600) } catch (error) { ignoreMissing(error) }
  },
  writePrivateFileAndSync (filePath, contents) {
    const descriptor = openSync(filePath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
    try {
      fchmodSync(descriptor, 0o600)
      writeFileSync(descriptor, contents)
      fsyncSync(descriptor)
    } finally {
      closeSync(descriptor)
    }
  },
  replace (temporaryPath, filePath) {
    renameSync(temporaryPath, filePath)
  },
  syncDirectory (directoryPath) {
    const descriptor = openSync(directoryPath, constants.O_RDONLY)
    try { fsyncSync(descriptor) } finally { closeSync(descriptor) }
  },
  removeTemporary (temporaryPath) {
    try { unlinkSync(temporaryPath) } catch (error) { ignoreMissing(error) }
  },
})

export const nodeAsyncDurableFileOperations = Object.freeze({
  async ensurePrivateDirectory (directoryPath) {
    await mkdir(directoryPath, { recursive: true, mode: 0o700 })
    await chmod(directoryPath, 0o700)
  },
  async hardenExistingFile (filePath) {
    try { await chmod(filePath, 0o600) } catch (error) { ignoreMissing(error) }
  },
  async writePrivateFileAndSync (filePath, contents) {
    const handle = await open(filePath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
    try {
      await handle.chmod(0o600)
      await handle.writeFile(contents)
      await handle.sync()
    } finally {
      await handle.close()
    }
  },
  async replace (temporaryPath, filePath) {
    await rename(temporaryPath, filePath)
  },
  async syncDirectory (directoryPath) {
    const handle = await open(directoryPath, constants.O_RDONLY)
    try { await handle.sync() } finally { await handle.close() }
  },
  async removeTemporary (temporaryPath) {
    await rm(temporaryPath, { force: true })
  },
})

const assertOperations = (operations, methods) => {
  methods.forEach(method => {
    if (typeof operations?.[method] !== 'function') throw new TypeError(`耐久文件操作缺少 ${method}`)
  })
}

export const hardenPrivateFileSync = (filePath, operations = nodeSyncDurableFileOperations) => {
  assertOperations(operations, ['ensurePrivateDirectory', 'hardenExistingFile'])
  operations.ensurePrivateDirectory(dirname(filePath))
  operations.hardenExistingFile(filePath)
}

export const hardenPrivateFile = async (filePath, operations = nodeAsyncDurableFileOperations) => {
  assertOperations(operations, ['ensurePrivateDirectory', 'hardenExistingFile'])
  await operations.ensurePrivateDirectory(dirname(filePath))
  await operations.hardenExistingFile(filePath)
}

export const durableReplaceFileSync = (filePath, contents, operations = nodeSyncDurableFileOperations) => {
  assertOperations(operations, ['ensurePrivateDirectory', 'writePrivateFileAndSync', 'replace', 'syncDirectory', 'removeTemporary'])
  const directoryPath = dirname(filePath)
  const temporaryPath = temporaryPathFor(filePath)
  operations.ensurePrivateDirectory(directoryPath)
  try {
    operations.writePrivateFileAndSync(temporaryPath, contents)
    operations.replace(temporaryPath, filePath)
    operations.syncDirectory(directoryPath)
  } finally {
    operations.removeTemporary(temporaryPath)
  }
}

export const durableReplaceFile = async (filePath, contents, operations = nodeAsyncDurableFileOperations) => {
  assertOperations(operations, ['ensurePrivateDirectory', 'writePrivateFileAndSync', 'replace', 'syncDirectory', 'removeTemporary'])
  const directoryPath = dirname(filePath)
  const temporaryPath = temporaryPathFor(filePath)
  await operations.ensurePrivateDirectory(directoryPath)
  try {
    await operations.writePrivateFileAndSync(temporaryPath, contents)
    await operations.replace(temporaryPath, filePath)
    await operations.syncDirectory(directoryPath)
  } finally {
    await operations.removeTemporary(temporaryPath)
  }
}
