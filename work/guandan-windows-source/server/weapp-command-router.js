export const COMMAND_HANDLED = Symbol('weapp-command-handled')

export const createCommandRouter = routes => {
  const owners = new Map()
  for (const route of routes) {
    for (const type of route.types) {
      if (owners.has(type)) throw new Error(`协议命令 ${type} 被重复注册`)
      owners.set(type, route.handle)
    }
  }
  return {
    registeredTypes: () => [...owners.keys()],
    async dispatch(context) {
      const handler = owners.get(context.type)
      if (!handler) return false
      await handler(context)
      return COMMAND_HANDLED
    },
  }
}
