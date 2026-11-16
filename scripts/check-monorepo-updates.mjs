/** 回归：子目录清单必须穿过真实 HTTP、service、store，最终仍安装同一个包。 */
import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { promisify } from 'node:util'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const repo = 'Wcof/plug-funds'
const directory = 'plugin/targets/dsh/investment'
const name = '@plug-funds/dsh-investment'
const head = '06b003dbbe86c52943d2e61eb75067254fc3b481'
const oldHead = '64fcb8cbcb6e29a64e03990b47f63d42daf0418d'
const indexUrl = 'https://raw.githubusercontent.com/Wcof/PlugBox/main/index.json'
const rootManifest = { name: 'plug-funds', version: '0.1.4' }
const manifest = { name, version: '0.1.4', engines: { dsh: '>=0.2.1-rc.3 <0.3.0' }, dsh: { bundle: { patch: './cordis.patch.yml' } } }
let branchHead = head
let failManifest = false
let failInstall = false
let holdNextManifest
let marketVisible = true
let listed = 0
const manifestUrls = []
const installedSpecs = []
const bundles = [{ name, version: '0.1.3', source: `git+https://github.com/${repo}.git#main&path:/${directory}`, installed: true, availability: 'profile', rows: [], enabled: true }]
const market = [{
  name, title: '投资工作站', repository: { url: `https://github.com/${repo}`, directory },
  metadata: { keywords: ['plugbox'], labels: [] }, defaultVersion: '0.1.3',
  versions: [{ version: '0.1.3', install: { spec: `git+https://github.com/${repo}.git#${oldHead}&path:/${directory}` }, compatibility: { compatible: true } }],
  installation: { status: 'installed', installedVersion: '0.1.3' },
}]
const originalFetch = globalThis.fetch
const originalExecFile = childProcess.execFile
const originalWindow = globalThis.window
const originalTimeout = globalThis.setTimeout
const timers = new Set()
const storage = new Map()
let temp
let server
let passed = 0
let failed = 0
async function check(label, fn) {
  try { await fn(); passed++; console.log(`✓ ${label}`) }
  catch (error) { failed++; console.error(`✗ ${label}: ${error.message}`) }
}

// 替换外部 git I/O，生产 Host 和其 HTTP 路由本身保持原样。
const execFile = () => { throw new Error('Expected promisified execFile') }
execFile[promisify.custom] = async (_file, args) => {
  listed++
  if (args.at(-1).includes('missing-repo')) throw Object.assign(new Error('not found'), { stderr: 'Repository not found' })
  return { stdout: `${branchHead}\trefs/heads/main\n`, stderr: '' }
}
childProcess.execFile = execFile
syncBuiltinESMExports()
const { apply } = await import('../index.js')
childProcess.execFile = originalExecFile
syncBuiltinESMExports()

try {
  globalThis.window = { localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) } }
  globalThis.setTimeout = (fn, ms, ...args) => {
    const timer = originalTimeout(fn, ms, ...args)
    timers.add(timer)
    return timer
  }
  const services = {
    pluginManager: {
      listBundles: () => bundles,
      listPlugins: () => [],
      setBundleEnabled: (bundleName, enabled) => ({ bundleName, enabled }),
      installBundle: spec => {
        installedSpecs.push(spec)
        if (failInstall) return { changed: false, application: 'failed', stage: 'install', target: name, error: { code: 'fixture-install-failed', message: '模拟安装失败' } }
        bundles[0].source = spec
        bundles[0].version = '0.1.4'
        return { changed: true, application: 'applied', stage: 'install', target: name }
      },
    },
    pluginMarket: {
      listIndexes: () => [{ url: indexUrl }],
      search: (url, query) => ({ url, title: 'Test', entries: marketVisible ? market : [], total: marketVisible ? 1 : 0, nextOffset: null, query }),
    },
  }
  let route
  apply({ get: key => services[key], inject: (_deps, fn) => fn({ effect: fn => fn(), webServer: { register: r => { route = r; return () => {} } } }) })
  server = createServer(route.handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  const endpoint = `${base}/plugbox/api/rpc`
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url.startsWith('https://raw.githubusercontent.com/')) {
      manifestUrls.push(url)
      if (holdNextManifest) {
        const hold = holdNextManifest
        holdNextManifest = undefined
        hold.started()
        await hold.release
      }
      if (failManifest) throw new Error('read ECONNRESET')
      if (url.includes('/missing-package/')) return new Response('', { status: 404 })
      return Response.json(url.includes(`/${directory}/`) ? manifest : rootManifest)
    }
    return originalFetch(url === './api/rpc' ? endpoint : url, init)
  }
  const rpc = async (method, params = {}, headers = {}) => {
    const response = await originalFetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ method, params }) })
    return { status: response.status, ...await response.json() }
  }
  await mkdir('.tmp', { recursive: true })
  temp = await mkdtemp(resolve('.tmp/monorepo-regression-'))
  await build({ stdin: { contents: "export * as service from './src/services/pluginService'; export { pluginCenter } from './src/stores/pluginCenter'; export * as baselines from './src/stores/branchBaseline'; export { HOST } from './src/types/plugin'", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', outfile: `${temp}/frontend.mjs`, logLevel: 'silent' })
  const { service, pluginCenter: center, baselines, HOST } = await import(pathToFileURL(`${temp}/frontend.mjs`).href)

  await check('HTTP 子目录清单：0.1.4、组合包与兼容范围均来自实际包', async () => {
    const result = await rpc('repoBranches', { repo, path: directory })
    assert.equal(result.status, 200)
    assert.equal(result.result.branches[0].bundle, true)
    assert.equal(result.result.branches[0].version, '0.1.4')
    assert.equal(result.result.branches[0].enginesDsh, manifest.engines.dsh)
    assert.ok(manifestUrls.some(url => url.includes(`/${head}/${directory}/package.json`)))
  })
  await check('仓库根和不同包目录的缓存互不串用，重复请求命中缓存', async () => {
    const root = await rpc('repoBranches', { repo })
    assert.equal(root.result.branches[0].bundle, false)
    const before = listed
    const sub = await rpc('repoBranches', { repo, path: directory })
    assert.equal(sub.result.branches[0].bundle, true)
    assert.equal(listed, before)
    const missing = await rpc('repoBranches', { repo, path: 'missing-package' })
    assert.equal(missing.result.branches[0].bundle, false)
  })
  await check('非法子目录在网络或 git 调用前拒绝', async () => {
    const before = listed
    for (const path of ['../secret', '/absolute', 'a/../b', 'a//b', 'a\\b', '%2e%2e/x', 'a&path:/b', 'a?x', 'a#b', '.', '', 42]) {
      const result = await rpc('repoBranches', { repo, path })
      assert.equal(result.status, 400, JSON.stringify(path))
      assert.equal(result.error.code, 'invalid-params')
    }
    assert.equal(listed, before)
  })
  await check('service 保留 repository.directory 并透传扫描路径', async () => {
    const { entries } = await service.searchIndex(indexUrl)
    assert.equal(entries[0].repositoryDirectory, directory)
    assert.equal((await service.listRepoBranches(repo, directory))[0].bundle, true)
  })
  await check('启动静默检查在索引滞后时也发现子目录的 0.1.4', async () => {
    await center.init()
    assert.ok(center.state.branchUpdates.some(item => item.name === name && item.version === '0.1.4'))
  })
  await check('手动检查和提醒安装参数保留包目录', async () => {
    await center.checkUpdates()
    const update = center.state.branchUpdates.find(item => item.name === name)
    assert.equal(update?.version, '0.1.4')
    assert.equal(update.spec, `git+https://github.com/${repo}.git#main&path:/${directory}`)
  })
  await check('卡片分支安装与安装后基线仍指向子目录', async () => {
    const { entries } = await service.searchIndex(indexUrl)
    const { branches } = await center.loadRepoBranches(repo, directory)
    assert.equal(await center.installBranchAt(entries[0], repo, branches[0]), true)
    assert.equal(installedSpecs.at(-1), `git+https://github.com/${repo}.git#main&path:/${directory}`)
    assert.ok(baselines.getRepoBaseline(repo, directory))
    assert.equal(center.state.branchUpdates.some(item => item.name === name), false)
  })
  await check('更新后相同提交不再提醒，索引落后不触发降级', async () => {
    await center.checkUpdates()
    assert.equal(center.state.branchUpdates.length, 0)
    assert.equal(center.state.bundles[0].updateSpec, undefined)
  })
  await check('索引未携带 directory 时，分支安装从已有来源恢复子目录', async () => {
    const { entries } = await service.searchIndex(indexUrl)
    delete entries[0].repositoryDirectory
    assert.equal(await center.installBranchAt(entries[0], repo, { name: 'main', version: '0.1.4', bundle: true }), true)
    assert.equal(installedSpecs.at(-1), `git+https://github.com/${repo}.git#main&path:/${directory}`)
  })
  await check('同仓不同包基线互不覆盖，根目录旧基线仍可读', () => {
    const old = { names: ['main'], heads: { main: oldHead } }
    const current = { names: ['main'], heads: { main: head } }
    baselines.putRepoBaseline(repo, old, 'install')
    baselines.putRepoBaseline(repo, old, 'install', directory)
    baselines.putRepoBaseline(repo, current, 'check', 'packages/other')
    assert.equal(baselines.getRepoBaseline(repo).heads.main, oldHead)
    assert.equal(baselines.getRepoBaseline(repo, directory).heads.main, oldHead)
    assert.equal(baselines.getRepoBaseline(repo, 'packages/other').heads.main, head)
  })
  await check('未订阅条目时从安装来源恢复目录，含 path 的 ref 仍识别 head 变化', async () => {
    marketVisible = false
    bundles[0].version = '0.1.4'
    await center.checkUpdates()
    assert.equal(center.state.branchUpdates.find(item => item.name === name)?.reason, 'head')
    marketVisible = true
    bundles[0].version = '0.1.3'
  })
  await check('适配器解析 path 和带斜杠分支，根目录安装保持可用', () => {
    const spec = HOST.gitSource.branchSpec(repo, 'release/next', directory)
    assert.deepEqual(HOST.gitSource.parse(spec), { ref: 'release/next', directory })
    assert.deepEqual(HOST.gitSource.parse(`git+https://github.com/${repo}.git#main`), { ref: 'main' })
    assert.equal(HOST.gitSource.branchSpec(repo, 'main'), `git+https://github.com/${repo}.git#main`)
  })
  await check('强制检查绕过 60 秒缓存，能立即读到新提交', async () => {
    branchHead = 'a'.repeat(40)
    const result = await rpc('repoBranches', { repo, path: directory, refresh: true })
    assert.equal(result.result.branches[0].commit, branchHead)
    branchHead = head
  })
  await check('清单网络失败不能伪装成非插件或已是最新，保留已有提醒', async () => {
    failManifest = true
    const response = await rpc('repoBranches', { repo, path: directory, refresh: true })
    assert.equal(response.status, 400)
    assert.equal(response.error.code, 'github-unavailable')
    const before = center.state.branchUpdates.length
    center.state.toasts.splice(0)
    await center.checkUpdates()
    assert.equal(center.state.branchUpdates.length, before)
    assert.ok(center.state.toasts.some(item => item.text.includes('不完整')))
    assert.ok(!center.state.toasts.some(item => item.text.includes('已是最新')))
    failManifest = false
  })
  await check('在途扫描晚于安装返回时不能覆盖新基线或恢复旧提醒', async () => {
    let release
    let started
    const pending = new Promise(resolve => { started = resolve })
    holdNextManifest = { started, release: new Promise(resolve => { release = resolve }) }
    const scan = center.checkUpdates()
    try {
      await Promise.race([pending, new Promise((_, reject) => setTimeout(() => reject(new Error('scan did not start')), 2000))])
      branchHead = 'b'.repeat(40)
      assert.equal(await center.installSpec(`git+https://github.com/${repo}.git#main&path:/${directory}`), true)
    } finally { release() }
    await scan
    assert.equal(baselines.getRepoBaseline(repo, directory).heads.main, branchHead)
    assert.equal(baselines.getRepoBaseline(repo, directory).origin, 'install')
    assert.equal(center.state.branchUpdates.length, 0)
    branchHead = head
  })
  await check('一键更新失败不推进基线，也不清除已有分支提醒', async () => {
    bundles[0].version = '0.1.3'
    market[0].defaultVersion = '0.1.4'
    market[0].versions[0].version = '0.1.4'
    market[0].versions[0].install.spec = `git+https://github.com/${repo}.git#${head}&path:/${directory}`
    baselines.putRepoBaseline(repo, { names: ['main'], heads: { main: oldHead } }, 'install', directory)
    await center.checkUpdates()
    failInstall = true
    try { await center.updateAll() } finally { failInstall = false }
    assert.equal(baselines.getRepoBaseline(repo, directory).heads.main, oldHead)
    assert.ok(center.state.branchUpdates.some(item => item.name === name))
  })
  await check('索引升版后的单个更新保留固定提交和目录，成功后推进基线', async () => {
    await center.updateOne(name)
    assert.equal(installedSpecs.at(-1), `git+https://github.com/${repo}.git#${head}&path:/${directory}`)
    assert.equal(center.state.bundles[0].version, '0.1.4')
    assert.equal(baselines.getRepoBaseline(repo, directory).heads.main, head)
    assert.equal(center.state.branchUpdates.length, 0)
  })
  await check('RPC 参数透传和跨站、未知方法、非 POST、非法仓库拒绝', async () => {
    assert.equal((await rpc('listBundles')).result[0].name, name)
    assert.deepEqual((await rpc('setBundleEnabled', { name, enabled: false })).result, { bundleName: name, enabled: false })
    const spec = `git+https://github.com/${repo}.git#main&path:/${directory}`
    assert.equal((await rpc('installBundle', { spec })).status, 200)
    assert.equal(installedSpecs.at(-1), spec)
    assert.equal((await rpc('searchMarket', { url: indexUrl, query: { limit: 101 } })).result.query.limit, 100)
    assert.equal((await rpc('status', {}, { 'sec-fetch-site': 'cross-site' })).status, 403)
    assert.equal((await rpc('status', {}, { origin: 'https://example.org' })).status, 403)
    assert.equal((await rpc('nonexistent')).status, 400)
    assert.equal((await originalFetch(endpoint)).status, 405)
    assert.equal((await rpc('repoBranches', { repo: '../bad' })).error.code, 'invalid-params')
    assert.equal((await rpc('repoBranches', { repo: 'owner/missing-repo' })).error.code, 'repo-unavailable')
  })
  await check('Host 静态入口、资源、补斜杠与路径穿越守卫', async () => {
    const response = await originalFetch(`${base}/plugbox/`)
    assert.equal(response.status, 200)
    const html = await response.text()
    const asset = html.match(/src="(\.\/assets\/[^"]+)"/)?.[1]
    assert.ok(asset)
    assert.equal((await originalFetch(`${base}/plugbox/${asset.slice(2)}`)).status, 200)
    assert.equal((await originalFetch(`${base}/plugbox`, { redirect: 'manual' })).status, 308)
    assert.notEqual((await originalFetch(`${base}/plugbox/%2e%2e%2fpackage.json`)).status, 200)
  })
  await check('缺少 web 产物返回 503 和修复提示', async () => {
    await copyFile('index.js', `${temp}/host-without-web.mjs`)
    const { apply: applyWithoutWeb } = await import(pathToFileURL(`${temp}/host-without-web.mjs`).href)
    let route
    applyWithoutWeb({ inject: (_deps, fn) => fn({ effect: fn => fn(), webServer: { register: r => { route = r; return () => {} } } }) })
    const emptyServer = createServer(route.handler)
    emptyServer.listen(0, '127.0.0.1')
    await once(emptyServer, 'listening')
    try {
      const response = await originalFetch(`http://127.0.0.1:${emptyServer.address().port}/plugbox/`)
      assert.equal(response.status, 503)
      assert.match(await response.text(), /npm run build/)
    } finally { emptyServer.closeAllConnections(); await new Promise(done => emptyServer.close(done)) }
  })
} finally {
  globalThis.fetch = originalFetch
  globalThis.window = originalWindow
  globalThis.setTimeout = originalTimeout
  childProcess.execFile = originalExecFile
  syncBuiltinESMExports()
  for (const timer of timers) clearTimeout(timer)
  if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)) }
  if (temp) await rm(temp, { recursive: true, force: true })
}
console.log(`子目录更新回归：${passed} 项通过，${failed} 项失败`)
if (failed) process.exitCode = 1
