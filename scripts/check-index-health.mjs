/**
 * 索引源读取判定的纯函数断言（node scripts/check-index-health.mjs）
 *
 * 真实故障：本地代理把到 raw.githubusercontent.com 的连接直接 RST，
 * 宿主报 `Could not fetch ...: fetch failed: read ECONNRESET`，一次就把整个索引源标失败。
 * 重试只该发生在「再试一次可能就好」的故障上——404 和格式错误重试多少次都一样。
 * 这里把判定规则变成断言，每次构建都会跑。
 */
import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Node 认不了省略扩展名的 TS 相对引用，先用 esbuild 把入口打成单文件再加载
const bundlePath = join(mkdtempSync(join(tmpdir(), 'plugbox-')), 'index-health.mjs')
await build({
  entryPoints: ['scripts/check-index-health-entry.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundlePath,
  logLevel: 'silent',
})
const { INDEX_RETRY_DELAYS_MS, describeTransientIndexFailure, isTransientIndexFailure, mirrorOf } =
  await import(pathToFileURL(bundlePath).href)

let failures = 0

function expect(label, actual, expected) {
  if (actual !== expected) {
    failures += 1
    console.error(`✗ ${label}\n  实际: ${JSON.stringify(actual)}\n  期望: ${JSON.stringify(expected)}`)
  }
}

function expectTransient(label, error, expected) {
  expect(`瞬时故障判定：${label}`, isTransientIndexFailure(error), expected)
}

// ---- 网络类：值得重试 ----
expectTransient(
  '真实报错原文（代理 RST）',
  new Error(
    'Could not fetch https://raw.githubusercontent.com/Wcof/DeepSeekBox/main/index.json: fetch failed: read ECONNRESET',
  ),
  true,
)
expectTransient('read ECONNRESET', new Error('read ECONNRESET'), true)
expectTransient('fetch failed', new Error('fetch failed'), true)
expectTransient('连接超时', new Error('connect ETIMEDOUT 185.199.108.133:443'), true)
expectTransient('socket hang up', new Error('socket hang up'), true)
expectTransient('DNS 临时失败', new Error('getaddrinfo EAI_AGAIN raw.githubusercontent.com'), true)
expectTransient('字符串形式的错误', 'fetch failed: read ECONNRESET', true)

// ---- 非网络类：重试没有意义 ----
expectTransient('404（含 Could not fetch 也不能重试）', new Error('Could not fetch https://example.com/index.json: 404 Not Found'), false)
expectTransient('403', new Error('Could not fetch https://example.com/index.json: 403 Forbidden'), false)
expectTransient('索引格式错误', new Error('Unexpected token < in JSON at position 0'), false)
expectTransient('宿主服务缺失', new Error('当前 profile 没有装载插件管理服务'), false)
expectTransient('宿主连不上', new Error('没有连上DeepSeek Harness宿主'), false)
expectTransient('空错误', new Error(''), false)
expectTransient('null', null, false)
expectTransient('undefined', undefined, false)

// ---- raw 直链 → jsDelivr 镜像 ----
expect(
  'raw 直链转镜像',
  mirrorOf('https://raw.githubusercontent.com/Wcof/PlugBox/main/index.json'),
  'https://cdn.jsdelivr.net/gh/Wcof/PlugBox@main/index.json',
)
expect(
  'raw 直链按 commit 转镜像',
  mirrorOf('https://raw.githubusercontent.com/Wcof/dsh-files/441b6544c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8/package.json'),
  'https://cdn.jsdelivr.net/gh/Wcof/dsh-files@441b6544c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8/package.json',
)
expect('http 也转', mirrorOf('http://raw.githubusercontent.com/o/r/main/index.json'), 'https://cdn.jsdelivr.net/gh/o/r@main/index.json')
expect('带查询串原样带过去', mirrorOf('https://raw.githubusercontent.com/o/r/main/index.json?raw=1'), 'https://cdn.jsdelivr.net/gh/o/r@main/index.json?raw=1')
expect('jsDelivr 不重复转', mirrorOf('https://cdn.jsdelivr.net/gh/Wcof/PlugBox@main/index.json'), null)
expect('第三方域名不转', mirrorOf('https://example.com/Wcof/PlugBox/index.json'), null)
// 多段 ref（feature/x）无法与路径区分，按第一段当 ref 处理；见 indexHealth.ts 的注释
expect('缺 owner/repo 不转', mirrorOf('https://raw.githubusercontent.com/index.json'), null)

// ---- 文案：说清发生了什么、重试几次、还能怎么绕 ----
const withMirror = describeTransientIndexFailure(
  'read ECONNRESET',
  'https://cdn.jsdelivr.net/gh/Wcof/PlugBox@main/index.json',
  INDEX_RETRY_DELAYS_MS.length,
)
expect('文案含重试次数', withMirror.includes(`已重试 ${INDEX_RETRY_DELAYS_MS.length} 次`), true)
expect('文案含底层原因', withMirror.includes('read ECONNRESET'), true)
expect('文案含镜像地址', withMirror.includes('可改用镜像 https://cdn.jsdelivr.net/gh/'), true)
const withoutMirror = describeTransientIndexFailure('', null, 2)
expect('无镜像时不提镜像', withoutMirror.includes('镜像'), false)
expect('原因为空时不加空括号', withoutMirror.includes('（）'), false)

if (failures > 0) {
  console.error(`✗ 索引源健康判定断言失败 ${failures} 项`)
  process.exit(1)
}
console.log('✓ 索引源健康判定断言全部通过（瞬时故障重试 + raw→jsDelivr 镜像）')
