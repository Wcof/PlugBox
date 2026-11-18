#!/usr/bin/env node
/**
 * 索引兼容性巡检：核对 index.json 登记的版本与各插件仓库的真实 package.json。
 *
 * 检查两件事：
 * 1. 收录 commit 上的 package.json 是否与索引一致（version 与 engines.dsh）；
 *    不一致说明升版时忘了重抓 engines.dsh——索引会继续按旧范围标注不兼容。
 * 2. 仓库 HEAD 的版本是否已经比收录版本新，提示可以跟进收录。
 *
 * 只读远程 raw 文件，不改任何东西；有第 1 类不一致时以退出码 1 结束。
 * 网络读取失败（重试 2 次仍失败）单列为「未核对」，不影响退出码——代理链路抖动
 * 不该被记成「索引不一致」，但结论不完整这件事必须打印出来。
 * 用法：npm run check:engines
 */
import { readFile } from 'node:fs/promises'

const TIMEOUT_MS = 15_000
/** 网络类失败重试两次：代理链路偶发 RST / 超时很常见，不该把一次抖动记成索引不一致 */
const RETRY_DELAYS_MS = [400, 900]

function describeError(error) {
  if (error?.name === 'TimeoutError') return '超时'
  const code = error?.cause?.code
  if (typeof code === 'string') return code
  return error instanceof Error ? error.message : String(error)
}

async function readPackage(repoUrl, ref, path) {
  const slug = repoUrl.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '')
  // monorepo 的包在子目录：索引的 source.path 就是相对仓库根的包位置，缺省才是仓库根
  const location = path === undefined ? ref : `${ref}/${path.replace(/^\/+|\/+$/g, '')}`
  const url = `https://raw.githubusercontent.com/${slug}/${location}/package.json`
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      // HTTP 状态是确定的答案（404 表示这个 commit 没这个包），重试没有意义
      if (!response.ok) return { error: `HTTP ${response.status}` }
      return { manifest: await response.json() }
    } catch (error) {
      if (attempt >= RETRY_DELAYS_MS.length) return { error: describeError(error) }
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]))
    }
  }
}

function enginesDshOf(manifest) {
  const range = manifest?.engines?.dsh
  return typeof range === 'string' ? range : undefined
}

const index = JSON.parse(await readFile(new URL('../index.json', import.meta.url), 'utf8'))
const SELF_REPO = 'Wcof/PlugBox'

const rows = []
let mismatches = 0
let outdated = 0
let unread = 0

for (const plugin of index.plugins) {
  const version = plugin.versions[0]
  const isSelf = version.source.url.endsWith(`/${SELF_REPO}`)
  const pinned = await readPackage(version.source.url, version.source.commit, version.source.path)
  const head = isSelf
    ? { skipped: true }
    : await readPackage(version.source.url, 'HEAD', version.source.path)

  // 自身条目的 commit 指向本地提交，未推送时远端读不到，按工作区的 package.json 核对
  let manifest = pinned.manifest
  let note = ''
  if (pinned.error && isSelf) {
    manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
    note = '（本地提交未推送，按本地 package.json 核对）'
  }

  const problems = []
  // 网络读不到 ≠ 索引不一致：单列成「未核对」，既不冒充不一致，也不让一次抖动把构建判死
  let unchecked = false
  if (manifest === undefined) {
    unchecked = true
  } else {
    if (manifest.version !== version.version) {
      problems.push(`版本不符：索引 ${version.version} / 包 ${manifest.version}`)
    }
    const actual = enginesDshOf(manifest)
    const declared = version.engines?.dsh
    if (actual !== declared) {
      problems.push(`engines.dsh 不符：索引 ${declared ?? '(未登记)'} / 包 ${actual ?? '(未声明)'}`)
    }
  }
  if (problems.length > 0) mismatches += 1
  if (unchecked) unread += 1

  const headVersion = head.manifest?.version
  const newer = headVersion !== undefined && headVersion !== version.version
  if (newer) outdated += 1

  const headText = head.skipped
    ? '—（本地仓库）'
    : head.error
      ? `读取失败（${head.error}）`
      : newer
        ? `v${headVersion}（有新版）`
        : `v${headVersion}（已最新）`

  rows.push({
    pinned: `${plugin.name}@${version.version}`,
    head: headText,
    status: unchecked
      ? `未核对（读取失败：${pinned.error}）`
      : problems.length === 0
        ? `一致${note}`
        : problems.join('；'),
    unchecked,
  })
}

const pad = (text, width) => text + ' '.repeat(Math.max(0, width - [...text].length))

const nameWidth = Math.max(...rows.map((row) => [...row.pinned].length))
const headWidth = Math.max(...rows.map((row) => [...row.head].length))

for (const row of rows) {
  const flag = row.unchecked ? '?' : row.status.startsWith('一致') ? '✓' : '✗'
  console.log(`${flag} ${pad(row.pinned, nameWidth)}  ${pad(row.head, headWidth)}  ${row.status}`)
}

console.log(
  `\n${rows.length} 个插件：${rows.length - mismatches - unread} 个一致，${mismatches} 个不一致，${unread} 个未能核对（网络）；${outdated} 个上游已有更新版本。`,
)

if (mismatches > 0) {
  console.error('索引与包声明不一致：请用 curl 重抓对应 commit 的 package.json，更新 VERSION_SOURCES.enginesDsh。')
  process.exitCode = 1
} else if (unread > 0) {
  console.error('有插件未能核对（网络读取失败，已重试 2 次）：结论不完整，但不算索引不一致。')
}
