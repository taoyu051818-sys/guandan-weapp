export type NavigatorClipboardApi = Readonly<{
  clipboard?: Readonly<{ writeText: (text: string) => Promise<void> }>
}>

export type WechatClipboardApi = Readonly<{
  setClipboardData?: (options: {
    data: string
    success: () => void
    fail: (error: unknown) => void
  }) => void
}>

const defaultNavigator = (): NavigatorClipboardApi | undefined => (
  (globalThis as typeof globalThis & { navigator?: NavigatorClipboardApi }).navigator
)

const defaultWechat = (): WechatClipboardApi | undefined => (
  (globalThis as typeof globalThis & { wx?: WechatClipboardApi }).wx
)

/** Writes one complete credential through the web or WeChat clipboard API. */
export const writeClipboardText = async (
  text: string,
  navigatorApi: NavigatorClipboardApi | undefined = defaultNavigator(),
  wechatApi: WechatClipboardApi | undefined = defaultWechat(),
): Promise<void> => {
  if (navigatorApi?.clipboard?.writeText) {
    await navigatorApi.clipboard.writeText(text)
    return
  }
  if (wechatApi?.setClipboardData) {
    await new Promise<void>((resolve, reject) => {
      wechatApi.setClipboardData?.({
        data: text,
        success: resolve,
        fail: error => reject(error instanceof Error ? error : new Error('复制邀请口令失败')),
      })
    })
    return
  }
  throw new Error('当前运行环境不支持复制，请升级客户端后重试')
}
