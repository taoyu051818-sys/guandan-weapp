type PickerApi = {
  requirePrivacyAuthorize?: (options: { success: () => void, fail: () => void }) => void
  chooseImage: (options: { count: number, sizeType: string[], sourceType: string[], success: (result: { tempFilePaths: string[] }) => void, fail: (error: { errMsg?: string }) => void }) => void
  createCanvas: () => HTMLCanvasElement
  createImage: () => HTMLImageElement
}

/** User-initiated album selection. Re-encode/crop locally; never send original photos or EXIF. */
export async function pickProfileImage (): Promise<string | null> {
  const wx = (globalThis as unknown as { wx?: PickerApi }).wx
  let source: string | null = null
  if (wx) {
    if (!wx.chooseImage || !wx.createCanvas || !wx.createImage) throw new Error('当前微信版本不支持上传头像，请更新微信')
    if (wx.requirePrivacyAuthorize) await new Promise<void>((resolve, reject) => wx.requirePrivacyAuthorize!({ success: resolve, fail: () => reject(new Error('上传头像需要同意隐私保护指引')) }))
    source = await new Promise<string | null>((resolve, reject) => wx.chooseImage({ count: 1, sizeType: ['compressed'], sourceType: ['album'],
      success: result => resolve(result.tempFilePaths[0] || null), fail: error => /cancel/i.test(error.errMsg || '') ? resolve(null) : reject(new Error('无法打开相册，请检查相册权限')) }))
  } else {
    if (typeof document === 'undefined') throw new Error('请在微信或浏览器中上传头像')
    source = await new Promise<string | null>((resolve, reject) => {
      const input = document.createElement('input')
      input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp'
      input.oncancel = () => resolve(null)
      input.onchange = () => {
        const file = input.files?.[0]
        if (!file) { resolve(null); return }
        if (file.size > 10 * 1024 * 1024) { reject(new Error('请选择10MB以内的图片')); return }
        resolve(URL.createObjectURL(file))
      }
      input.click()
    })
  }
  if (!source) return null
  try {
    const image = wx ? wx.createImage() : new Image()
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { image.onload = null; image.onerror = null; reject(new Error('图片读取超时，请重新选择')) }, 15000)
      image.onload = () => { clearTimeout(timer); resolve() }
      image.onerror = () => { clearTimeout(timer); reject(new Error('图片无法读取，请换一张')) }
      image.src = source!
    })
    if (!image.width || !image.height || image.width * image.height > 40_000_000) throw new Error('图片尺寸过大或无效')
    const canvas = wx ? wx.createCanvas() : document.createElement('canvas')
    canvas.width = 256; canvas.height = 256
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前设备无法处理头像')
    const edge = Math.min(image.width, image.height)
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, 256, 256)
    context.drawImage(image, (image.width - edge) / 2, (image.height - edge) / 2, edge, edge, 0, 0, 256, 256)
    const data = canvas.toDataURL('image/jpeg', 0.75)
    if (!/^data:image\/jpeg;base64,/.test(data) || data.length > 88000) throw new Error('头像压缩失败，请换一张较简单的图片')
    return data
  } finally { if (!wx && source.startsWith('blob:')) URL.revokeObjectURL(source) }
}
