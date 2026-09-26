// Build-time only: derive a transparent metallic cross from the user's Canvas example.
// PLAYWRIGHT_MODULE may point at an existing Playwright installation; no runtime dependency.
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')

;(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage()
    const data = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 256
      const ctx = canvas.getContext('2d')
      const rgba = a => `rgba(255,241,197,${a})`
      const glow = (radius, alpha) => {
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, radius)
        g.addColorStop(0, `rgba(255,255,255,${alpha})`)
        g.addColorStop(.08, rgba(alpha * .95)); g.addColorStop(.35, rgba(alpha * .35)); g.addColorStop(1, rgba(0))
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.fill()
      }
      const ray = (length, thickness, alpha) => {
        const g = ctx.createLinearGradient(-length, 0, length, 0)
        for (const [at, amount] of [[0, 0], [.15, .1], [.32, .42], [.45, .82], [.5, 1], [.55, .82], [.68, .42], [.85, .1], [1, 0]])
          g.addColorStop(at, at === .5 ? `rgba(255,255,255,${alpha})` : rgba(alpha * amount))
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-length, 0); ctx.lineTo(0, -thickness)
        ctx.lineTo(length, 0); ctx.lineTo(0, thickness); ctx.closePath(); ctx.fill()
      }
      const cross = (length, thickness, alpha, angle = 0) => {
        ctx.save(); ctx.rotate(angle); ray(length, thickness, alpha); ctx.rotate(Math.PI / 2); ray(length, thickness, alpha); ctx.restore()
      }
      ctx.translate(128, 128); ctx.scale(.4, .4)
      ctx.globalCompositeOperation = 'screen'
      glow(120, .10); glow(72, .20)
      cross(300, 24, .12); cross(248.4, 18, 1); cross(285, 3.6, .95)
      cross(102, 2.2, .5, Math.PI / 4); cross(48, 1.5, .18, Math.PI / 4 + .18)
      glow(32, .55); glow(16, .85)
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 22.4)
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.18, 'rgba(255,255,255,.98)')
      g.addColorStop(.38, rgba(.85)); g.addColorStop(1, rgba(0))
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 22.4, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,1)'; ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill()
      return canvas.toDataURL('image/png').split(',')[1]
    })
    const target = path.resolve(__dirname, '../assets/game-assets/effects/lobby-v1/metal-star-glint.png')
    const png = Buffer.from(data, 'base64')
    fs.writeFileSync(target, png)
    console.log(`${target}: ${png.length} bytes, 256x256 RGBA`)
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
