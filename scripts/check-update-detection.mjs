/**
 * 检查更新判定的纯函数断言（node scripts/check-update-detection.mjs）
 *
 * 「装了分支之后上游推了新提交，重开面板第一次检查却查不出来」是真实发生过的漏检：
 * 基线原本只存内存，面板重开就没。这里把判定规则变成断言，每次构建都会跑。
 *
 * 新增判定场景时不用改这个脚本——先在 branch-diff / version 里实现，再在这里补断言。
 */
import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Node 认不了省略扩展名的 TS 相对引用，先用 esbuild 把入口打成单文件再加载
const bundlePath = join(mkdtempSync(join(tmpdir(), 'plugbox-')), 'update-detection.mjs')
await build({
  entryPoints: ['scripts/check-update-detection-entry.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundlePath,
  logLevel: 'silent',
})
const { compareVersions, diffBranches, baselineFromScan } = await import(
  pathToFileURL(bundlePath).href
)

let failures = 0
/** 断言比较结果：符号用 -1 / 0 / 1 描述期望方向 */
function expectOrder(a, b, expected) {
  const actual = Math.sign(compareVersions(a, b))
  if (actual !== expected) {
    failures += 1
    console.error(`✗ compareVersions(${a}, ${b}) = ${actual}，期望 ${expected}`)
  }
}

function expectFindings(label, input, expected) {
  const actual = diffBranches(input)
  const normalize = (list) =>
    JSON.stringify(list.map((f) => `${f.reason}:${f.branch}:${f.newer ? 1 : 0}`))
  if (normalize(actual) !== normalize(expected)) {
    failures += 1
    console.error(`✗ ${label}\n  实际: ${normalize(actual)}\n  期望: ${normalize(expected)}`)
  }
}

const scan = (name, extra = {}) => ({ name, bundle: true, ...extra })

// ---- compareVersions：prerelease 语义 ----
expectOrder('1.2.3', '1.2.3', 0)
expectOrder('0.2.10', '0.2.9', 1)
expectOrder('0.2.2', '0.2.2-rc.1', 1) // 装的是 rc，上游发布正式版：必须报更新
expectOrder('1.0.0-alpha.2', '1.0.0-alpha.10', -1) // 数字标识符按数值比
expectOrder('1.0.0-alpha', '1.0.0-alpha.1', -1) // 标识符更多且前缀相同者更大
expectOrder('1.0.0-alpha', '1.0.0-beta', -1) // 字母按字典序
expectOrder('1.0.0-1', '1.0.0-alpha', -1) // 数字标识符低于字母
expectOrder('1.0.0+build.5', '1.0.0', 0) // build 元数据不参与优先级
expectOrder('0.2.2-rc.1', '0.2.1', 1)
expectOrder('1.0.0-rc.1', '1.0.0-rc.2', -1)

// ---- diffBranches：无基线（本功能之前装的）只报版本抬升 ----
const installedFromMain = (version) => ({
  baseline: null,
  branches: [
    scan('main', { commit: 'newhead', version }),
    scan('legacy', { commit: 'aaa', version: '0.0.9' }),
  ],
  installedRef: 'main',
  installedVersion: '0.2.2',
})
expectFindings('无基线：同版本不报（诚实不装懂）', installedFromMain('0.2.2'), [])
expectFindings('无基线：所装分支版本抬升也报', installedFromMain('0.2.3'), [
  { reason: 'version', branch: 'main', newer: true },
])
expectFindings('无基线：旧分支低版本不报（不误报）', installedFromMain('0.2.2'), [])

// ---- diffBranches：有持久基线（面板装完记录 / 上次检查记录）----
const BASELINE = baselineFromScan([
  scan('main', { commit: 'head-at-install', version: '0.2.2' }),
  scan('legacy', { commit: 'aaa', version: '0.0.9' }),
])
const withBaseline = (branches, installedRef = 'main', installedVersion = '0.2.2') => ({
  baseline: BASELINE,
  branches,
  installedRef,
  installedVersion,
})

// 原始漏检场景：装分支后上游推了新提交（版本没动），重开面板首次检查必须报
expectFindings('基线：所装分支头提交变化（版本不变）', withBaseline([scan('main', { commit: 'pushed-later', version: '0.2.2' }), scan('legacy', { commit: 'aaa', version: '0.0.9' })]), [
  { reason: 'head', branch: 'main', newer: false },
])
// 上游推提交同时抬了版本：head 与 version 同时命中时报 head，但 newer 标记为真
expectFindings('基线：所装分支头提交变化且抬版本', withBaseline([scan('main', { commit: 'pushed-later', version: '0.2.3' }), scan('legacy', { commit: 'aaa', version: '0.0.9' })]), [
  { reason: 'head', branch: 'main', newer: true },
])
// 安装之后新建的分支：报 new
expectFindings('基线：新出现的分支', withBaseline([scan('main', { commit: 'head-at-install', version: '0.2.2' }), scan('legacy', { commit: 'aaa', version: '0.0.9' }), scan('feat/new-thing', { commit: 'bbb', version: '0.2.2' })]), [
  { reason: 'new', branch: 'feat/new-thing', newer: false },
])
// 其他分支版本更高：报 version（分支已在基线里，只是抬了版本）
const BASELINE_WITH_RELEASE = baselineFromScan([
  scan('main', { commit: 'head-at-install', version: '0.2.2' }),
  scan('release', { commit: 'old', version: '0.2.2' }),
])
expectFindings('基线：基线内分支抬版本报 version', { baseline: BASELINE_WITH_RELEASE, branches: [scan('main', { commit: 'head-at-install', version: '0.2.2' }), scan('release', { commit: 'ccc', version: '0.3.0' })], installedRef: 'main', installedVersion: '0.2.2' }, [
  { reason: 'version', branch: 'release', newer: true },
])
// 新分支同时版本更高：reason 优先 new（head → new → version），newer 标记仍为真
expectFindings('基线：新分支同时版本更高，reason 优先 new', withBaseline([scan('main', { commit: 'head-at-install', version: '0.2.2' }), scan('legacy', { commit: 'aaa', version: '0.0.9' }), scan('release', { commit: 'ccc', version: '0.3.0' })]), [
  { reason: 'new', branch: 'release', newer: true },
])
// 不误报：基线里的同头提交、低版本旧分支、没声明组合包的分支，都不报
expectFindings(
  '基线：无变更不报',
  withBaseline([
    scan('main', { commit: 'head-at-install', version: '0.2.2' }),
    scan('legacy', { commit: 'aaa', version: '0.0.9' }),
    scan('docs-only', { commit: 'ddd', version: null, bundle: false }),
  ]),
  [],
)
// 基线里 head 缺失（上次没读到）：不断言 head，避免凭空说「推了新提交」
expectFindings('基线：head 缺失不断言变化', { baseline: { names: ['main'], heads: { main: null } }, branches: [scan('main', { commit: 'whatever', version: '0.2.2' })], installedRef: 'main', installedVersion: '0.2.2' }, [])
// 基线之后新建的分支没有版本号：仍报 new（有组合包就有安装价值）
expectFindings('基线：新分支无版本号也报', withBaseline([scan('main', { commit: 'head-at-install', version: '0.2.2' }), scan('hotfix', { commit: 'eee', version: null })]), [
  { reason: 'new', branch: 'hotfix', newer: false },
])

if (failures > 0) {
  console.error(`✗ 检查更新判定断言失败 ${failures} 项`)
  process.exit(1)
}
console.log('✓ 检查更新判定断言全部通过（compareVersions prerelease 语义 + 分支差分）')
