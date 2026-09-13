// Audit only: memory loaders, synthetic ports, source/hash reads; no product writes.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '../../../..')
const cocos = path.join(root, 'work/guandan-cocos')
const { loadTypeScript } = require(path.join(cocos, 'tests/support/typescript.cjs'))
const ts = loadTypeScript()
const read = p => fs.readFileSync(p, 'utf8')
const hash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex')
const load = relative => require(path.join(cocos, relative))
const previous = Module._extensions['.ts']
Module._extensions['.ts'] = (m, filename) => m._compile(ts.transpileModule(read(filename), {
  fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename)
const summary = { typescript: ts.version }
async function main () {
  // Run the unchanged master policy regression against the reviewed src, not ignored dist.
  const oldLoad = Module._load
  const dist = path.join(root, 'shared-core/dist')
  let redirects = 0
  Module._load = function (request, parent, isMain) {
    if (request === dist) { redirects++; return oldLoad.call(this, path.join(root, 'shared-core/src/index.ts'), parent, isMain) }
    return oldLoad.call(this, request, parent, isMain)
  }
  try { load('tests/master-ai-policy-regression.cjs') } finally { Module._load = oldLoad }
  assert.equal(redirects, 1)
  summary.master = { passed: true, sourceRedirects: redirects }

  const { HttpMerchantGateway } = load('migration/platform/merchantGateway.ts')
  const { HttpShopGateway } = load('migration/platform/shopGateway.ts')
  const { PlatformApiError } = load('assets/scripts/services/platform/contracts.ts')
  const { SAMPLE_MERCHANT_CONSOLE, DevelopmentMerchantGateway, DevelopmentShopGateway,
    DevelopmentSpectatorGateway } = load('migration/platform/RetiredDevelopmentApis.ts')
  const clone = v => JSON.parse(JSON.stringify(v))
  const merchant = SAMPLE_MERCHANT_CONSOLE
  const operations = [
    [HttpMerchantGateway, 'apply', [{ name: 'audit synthetic', contactName: 'audit' }], { merchant: merchant.merchant }],
    [HttpMerchantGateway, 'createStore', [{ name: 'audit synthetic', address: 'synthetic' }], { store: merchant.stores[0] }],
    [HttpMerchantGateway, 'addEmployee', [{ employeeUserId: 'synthetic-user', role: 'cashier' }], { employee: merchant.employees[0] }],
    [HttpMerchantGateway, 'grantPoints', [{ storeId: 'synthetic-store', recipientUserId: 'synthetic-user', amount: 3, note: 'audit' }], { grant: merchant.grants[0] }],
    [HttpShopGateway, 'createOrder', ['synthetic-product', 1, 3], { order: { orderId: 'synthetic-order', productId: 'synthetic-product', quantity: 1, totalPoints: 3, status: 'created' } }],
  ]
  let retryScenarios = 0
  for (const [Gateway, method, args, response] of operations) {
    for (const failure of ['transport', 'server', 'malformed', 'client']) {
      const keys = []; let count = 0
      const client = { request: async (_url, _verb, _body, headers) => {
        keys.push(headers['Idempotency-Key'])
        if (count++ === 0) {
          if (failure === 'malformed') return {}
          throw new PlatformApiError('synthetic failure', { status: failure === 'server' ? 503 : failure === 'client' ? 400 : 0 })
        }
        return clone(response)
      } }
      const gateway = new Gateway(client)
      await assert.rejects(() => gateway[method](...args), PlatformApiError)
      await gateway[method](...args)
      assert.equal(keys[0] === keys[1], failure !== 'client')
      await gateway[method](...args)
      assert.notEqual(keys[1], keys[2], 'success releases the uncertain operation key')
      retryScenarios++
    }
  }
  let invalidRequests = 0
  const invalidClient = { request: async () => { invalidRequests++; throw Error('unexpected request') } }
  const guard = new HttpMerchantGateway(invalidClient)
  const invalid = [
    () => guard.apply({ name: '' }), () => guard.apply({ name: 'x'.repeat(61) }),
    () => guard.createStore({ name: 's', address: 'x'.repeat(121) }),
    () => guard.addEmployee({ employeeUserId: 's', role: 'owner' }),
    () => guard.grantPoints({ storeId: 's', recipientUserId: 'u', amount: 1001 }),
    () => guard.grantPoints({ storeId: 's', recipientUserId: 'u', amount: 0 }),
    () => guard.grantPoints({ storeId: 's', recipientUserId: 'u', amount: 1.5 }),
    () => new HttpShopGateway(invalidClient).createOrder('', 1),
    () => new HttpShopGateway(invalidClient).createOrder('s', -1),
    () => new HttpShopGateway(invalidClient).createOrder('s', 1, NaN),
  ]
  for (const action of invalid) await assert.rejects(action, PlatformApiError)
  assert.equal(invalidRequests, 0)
  for (const collection of ['stores', 'employees', 'grants']) {
    const body = clone(merchant); body[collection][0].merchantId = 'another-synthetic-merchant'
    await assert.rejects(() => new HttpMerchantGateway({ request: async () => body }).getConsole(), /其他商户/)
  }
  for (const method of ['apply', 'createStore', 'addEmployee', 'grantPoints']) {
    await assert.rejects(() => new DevelopmentMerchantGateway()[method]({}), /未开放|开发|暂未|不能/)
  }
  await assert.rejects(() => new DevelopmentShopGateway().createOrder('synthetic', 1), /未开放|开发|暂未|不能/)
  summary.gateways = { retryScenarios, invalidInputs: invalid.length, invalidNetworkCalls: invalidRequests, foreignCollections: 3, readOnlyMethods: 5 }

  const { shouldStopSpectatorPolling } = load('migration/spectator/SpectatorPollingPolicy.ts')
  const { HttpSpectatorGateway } = load('migration/platform/spectatorGateway.ts')
  const finished = await new DevelopmentSpectatorGateway().getFeed('demo-match')
  const decoded = await new HttpSpectatorGateway({ request: async () => ({ feed: finished }) }).getFeed('demo-match')
  assert.equal(decoded.status, 'completed'); assert.equal(decoded.timelineComplete, true)
  assert.equal(shouldStopSpectatorPolling(decoded), false)
  assert.equal(shouldStopSpectatorPolling({ ...decoded, status: 'finished' }), true)
  assert.equal(shouldStopSpectatorPolling({ ...decoded, status: 'aborted' }), true)
  summary.retiredPolling = { canonicalStatus: decoded.status, timelineComplete: true, stops: false, finishedAndAbortedControlsStop: true, classification: 'inactive migration reactivation concern, not current friend-room observer defect' }

  const { projectRuleHelp } = load('migration/rules/RuleHelpProjection.ts')
  for (let mask = 0; mask < 8; mask++) {
    const flags = { enableTripleWithPair: !!(mask & 1), allowA2345Straight: !!(mask & 2), straightFlushAsBomb: !!(mask & 4) }
    const pages = projectRuleHelp(flags)
    assert.equal(pages.length, 5); assert.ok(Object.isFrozen(pages)); pages.forEach(p => assert.ok(Object.isFrozen(p)))
    assert.ok(pages[1].content.includes(flags.enableTripleWithPair ? '三带二可用' : '三带二关闭'))
    assert.ok(pages[1].content.includes(flags.allowA2345Straight ? 'A2345可作为最小顺子' : 'A2345不能组成顺子'))
    assert.ok(pages[2].content.includes(flags.straightFlushAsBomb ? '五张半' : '普通顺子'))
  }
  summary.ruleHelpProfiles = 8

  // Check real type errors, not only a transpiler or unused-variable diagnostic.
  // Match package.json's tsc compiler and project cwd, including relative Cocos type libraries.
  const checker = require(path.join(cocos, 'node_modules/typescript'))
  const configFile = path.join(cocos, 'tsconfig.refactor-tests.json')
  const rawConfig = checker.readConfigFile(configFile, checker.sys.readFile); assert.equal(rawConfig.error, undefined)
  const config = checker.parseJsonConfigFileContent(rawConfig.config, checker.sys, cocos)
  assert.equal(config.errors.length, 0)
  const fixture = path.join(cocos, 'tests/support/refactor-type-contracts.ts')
  const original = read(fixture)
  const expected = original.split('\n').flatMap((line, index) => line.includes('@ts-expect-error') ? [index + 2] : [])
  const options = { ...config.options, noEmit: true, incremental: false, noUnusedLocals: false, noUnusedParameters: false }
  const host = checker.createCompilerHost(options)
  host.getCurrentDirectory = () => cocos
  const originalRead = host.readFile
  host.readFile = filename => path.resolve(filename) === fixture ? original.replace(/@ts-expect-error/g, 'AUDIT_EXPECT_ERROR') : originalRead(filename)
  const program = checker.createProgram(config.fileNames, options, host)
  const diagnostics = checker.getPreEmitDiagnostics(program)
  const targetDiagnostics = diagnostics.filter(d => d.file && path.resolve(d.file.fileName) === fixture)
    .map(d => ({ line: d.file.getLineAndCharacterOfPosition(d.start).line + 1, code: d.code }))
  for (const line of expected) assert.ok(targetDiagnostics.some(d => d.line === line), 'missing semantic rejection at line ' + line)
  assert.equal(diagnostics.length, targetDiagnostics.length, 'unrelated errors must not masquerade as negative test coverage')
  summary.typeContracts = { compiler: checker.version, expected: expected.length, errors: targetDiagnostics }
  // The deliberately illegal dashboard=null narrows later branches to never. Isolate those checks.
  host.readFile = filename => path.resolve(filename) === fixture
    ? original.replace(/@ts-expect-error/g, 'AUDIT_EXPECT_ERROR').replace('player.dashboard = null', 'void player.dashboard')
    : originalRead(filename)
  const isolated = checker.getPreEmitDiagnostics(checker.createProgram(config.fileNames, options, host))
    .filter(d => d.file && path.resolve(d.file.fileName) === fixture)
    .map(d => ({ line: d.file.getLineAndCharacterOfPosition(d.start).line + 1, code: d.code, message: checker.flattenDiagnosticMessageText(d.messageText, ' ') }))
  assert.equal(isolated.find(d => d.line === 38)?.code, 2540, 'nested name must be truly readonly, not narrowed to never')
  assert.match(isolated.find(d => d.line === 40)?.message ?? '', /readonly/)
  assert.equal(isolated.length, 13)
  summary.typeContracts.isolatedNestedReadonly = isolated.filter(d => [38, 40].includes(d.line))

  // Inspect emitted module references (includes export-from + literal dynamic import/require).
  const files = execFileSync('git', ['ls-files', '-z', 'work/guandan-cocos/assets/scripts'], { cwd: root, encoding: 'utf8' })
    .split('\0').filter(p => p.endsWith('.ts')).map(p => path.join(root, p))
  let references = 0; const unresolvedDynamic = []; const retiredReferences = []
  for (const file of files) {
    const emitted = ts.transpileModule(read(file), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
    const tree = ts.createSourceFile(file + '.js', emitted, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    const visit = n => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'require') {
        const arg = n.arguments[0]
        if (!arg || !ts.isStringLiteral(arg)) unresolvedDynamic.push(path.relative(root, file))
        else {
          references++
          const spec = arg.text.replace('db://assets/', path.join(cocos, 'assets/'))
          const resolved = spec.startsWith('.') ? path.resolve(path.dirname(file), spec) : spec
          if (/(^|\/)(migration|tests|asset-library)(\/|$)/.test(resolved)) retiredReferences.push({ file: path.relative(root, file), spec })
        }
      }
      ts.forEachChild(n, visit)
    }
    visit(tree)
  }
  assert.deepEqual(retiredReferences, [])
  summary.runtimeBoundary = { files: files.length, emittedReferences: references, forbiddenReferences: retiredReferences, unresolvedDynamic }

  const archived = JSON.parse(read(path.join(root, 'asset-library/retired-audio/quick-chat/manifest.json')))
  assert.equal(archived.runtimeAllowed, false)
  for (const item of archived.assets) {
    const file = path.join(root, 'asset-library/retired-audio/quick-chat', item.file)
    assert.equal(hash(file), item.sha256); assert.equal(fs.statSync(file).size, item.bytes)
  }
  const retirement = JSON.parse(read(path.join(cocos, 'asset-library/retired-runtime-20260908/manifest.json')))
  for (const item of retirement.laboratoryRetirement.archivedSources) {
    assert.ok(fs.existsSync(path.join(cocos, item.archivePath)))
    assert.ok(fs.existsSync(path.join(cocos, item.metadataArchivePath)))
    assert.equal(fs.existsSync(path.join(cocos, item.path)), false)
  }
  summary.archive = { quickChatClips: archived.assets.length, bytes: archived.assets.reduce((s, x) => s + x.bytes, 0), laboratorySnapshots: retirement.laboratoryRetirement.archivedSources.length, snapshotContentNotExecuted: true }
  console.log('AUDIT31_RESULT=' + JSON.stringify(summary))
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => {
  if (previous) Module._extensions['.ts'] = previous
  else delete Module._extensions['.ts']
})
