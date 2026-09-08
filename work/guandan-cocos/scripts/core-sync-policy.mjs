/** The desktop compatibility barrel is not a Cocos dependency; keep its source in shared-core. */
export const isClientSharedCoreSource = relativePath => relativePath.replaceAll('\\', '/') !== 'lib/ai.ts'
