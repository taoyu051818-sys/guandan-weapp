const assert = require('node:assert/strict')
const path = require('node:path')
const { loadTs } = require('./support/load-typescript-module.cjs')
const { pickProfileImage } = loadTs(path.resolve(__dirname, '../assets/scripts/services/ProfileImagePicker.ts'))
async function run () {
  let consent = false, draw
  const data = 'data:image/jpeg;base64,AAAA'
  global.wx = {
    requirePrivacyAuthorize: ({ success }) => { consent = true; success() },
    chooseImage: ({ count, success }) => { assert.ok(consent); assert.equal(count, 1); success({ tempFilePaths: ['/tmp/photo'] }) },
    createImage: () => ({ width: 1200, height: 800, set src (_) { this.onload() } }),
    createCanvas: () => ({ getContext: () => ({ fillRect () {}, drawImage (...args) { draw = args } }), toDataURL: (mime, quality) => { assert.equal(mime, 'image/jpeg'); assert.equal(quality, 0.75); return data } }),
  }
  assert.equal(await pickProfileImage(), data)
  assert.deepEqual(draw.slice(1), [200, 0, 800, 800, 0, 0, 256, 256], 'center crop without stretching')
  global.wx.chooseImage = ({ fail }) => fail({ errMsg: 'chooseImage:fail cancel' })
  assert.equal(await pickProfileImage(), null)
  global.wx.requirePrivacyAuthorize = ({ fail }) => fail()
  await assert.rejects(pickProfileImage(), /隐私/)
  delete global.wx
  console.log('Avatar picker: explicit privacy, cancellation, center crop and JPEG re-encoding passed')
}
run().catch(error => { console.error(error); process.exitCode = 1 })
