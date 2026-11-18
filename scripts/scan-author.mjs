#!/usr/bin/env node
/**
 * 维护侧发现：扫某个作者名下的公开仓库，找出「可收录 / 待收录」的 DSH 组合包。
 *
 * 为什么需要它：索引是人工收录库（`src/data/catalog.ts`），上游发版不会自己进来。
 * `check:engines` 只复盘「已经收录的条目有没有落后」，对「作者新发的仓库」一无所知；
 * 这个脚本补的正是那一段——列出候选、算清版本差，把该写的数字准备好。
 *
 * 只读：不写 index.json、不改 catalog.ts、不碰 git。输出给人看，确认后才手工收录。
 *
 * 用法：
 *   npm run scan:author                  # 默认扫 Wcof
 *   npm run scan:author -- joeseesun
 *   npm run scan:author -- Wcof --pin    # 额外解析提交与发布时间，输出可粘贴片段
 *   npm run scan:author -- Wcof --json   # 机器可读（npm 会打横幅，管道解析建议改用 --out）
 *   npm run scan:author -- Wcof --out=/tmp/scan.json
 *   npm run scan:author -- Wcof --strict # 有待收录/候选时退出码 1（留给 CI 用）
 *
 * 仓库清单优先用 `gh repo list`（能看到私有仓库，进而明确报「不可收录」）；
 * gh 不可用时退回仓库列表页抓取（只知公开仓库），再退回 GitHub REST。
 */

import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const TIMEOUT_MS = 20_000
/** 代理链路偶发 RST / 超时：读三次再认输，别把抖动当成「仓库没有这个包」 */
const RETRY_DELAYS = [400, 900]
const SELF_REPO = 'wcof/plugbox'

const argv = process.argv.slice(2)
const flags = new Set(argv.filter((arg) => arg.startsWith('--')))
const positional = argv.filter((arg) => !arg.startsWith('-'))
const owner = positional[0] ?? 'Wcof'
const wantJson = flags.has('--json')
const wantPin = flags.has('--pin')
const strict = flags.has('--strict')
/** `--out=path`：把 JSON 写到文件。npm run 会在 stdout 前面打横幅，管道解析会被它呛到 */
const outPath = argv.find((arg) => arg.startsWith('--out='))?.slice('--out='.length)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

if (flags.has('--help') || argv.includes('-h')) {
  console.log(`用法：node scripts/scan-author.mjs [作者] [选项]

  [作者]          默认 Wcof
  --pin           解析待收录/候选的提交与发布时间，输出可粘贴片段
  --json          JSON 到 stdout（npm run 会打横幅，管道解析请用 --out）
  --out=文件       JSON 写入文件
  --strict        有待收录/候选时退出码 1
  --help          本说明

只读：不写 index.json、不改 catalog.ts、不碰 git。`)
  process.exit(0)
}

function describeError(error) {
  if (error?.name === 'TimeoutError') return '超时'
  const code = error?.cause?.code
  if (typeof code === 'string') return code
  return error instanceof Error ? error.message : String(error)
}

/** 读文本（带重试）；HTTP 4xx 是确定答案，不重试 */
async function readText(url) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'User-Agent': 'plugbox-scan-author' },
      })
      if (!response.ok) return { error: `HTTP ${response.status}` }
      return { text: await response.text() }
    } catch (error) {
      if (attempt >= RETRY_DELAYS.length) return { error: describeError(error) }
      await sleep(RETRY_DELAYS[attempt])
    }
  }
}

// 版本比较必须和运行时同一套规则（含 prerelease），不在这里重写一份
const bundlePath = join(mkdtempSync(join(tmpdir(), 'plugbox-scan-author-')), 'compare.mjs')
await build({
  entryPoints: ['scripts/scan-author-entry.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundlePath,
  logLevel: 'silent',
})
const { compareVersions } = await import(pathToFileURL(bundlePath).href)

function listReposWithGh(name) {
  const out = execFileSync(
    'gh',
    ['repo', 'list', name, '--limit', '500', '--json', 'name,isPrivate,isArchived,description'],
    { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  return JSON.parse(out).map((repo) => ({
    name: repo.name,
    private: repo.isPrivate === true,
    archived: repo.isArchived === true,
    description: repo.description ?? '',
  }))
}

async function listReposFromHtml(name) {
  const repos = new Map()
  for (let page = 1; page <= 5; page += 1) {
    const { text, error } = await readText(`https://github.com/${name}?tab=repositories&page=${page}`)
    if (error !== undefined) return { error }
    const pattern = new RegExp(`href="/${name}/([A-Za-z0-9._-]+)"`, 'g')
    const fresh = [...text.matchAll(pattern)]
      .map((match) => match[1])
      .filter((repo) => !repos.has(repo))
    for (const repo of fresh) {
      repos.set(repo, { name: repo, private: false, archived: false, description: '' })
    }
    // 没有新名字说明到底了（GitHub 的仓库列表页不保证有「下一页」标记）
    if (fresh.length === 0) break
  }
  return { repos: [...repos.values()] }
}

async function listReposFromApi(name) {
  const { text, error } = await readText(
    `https://api.github.com/users/${name}/repos?per_page=100&sort=updated`,
  )
  if (error !== undefined) return { error }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { error: 'REST 返回非 JSON' }
  }
  if (!Array.isArray(parsed)) return { error: parsed?.message ?? 'REST 返回异常' }
  return {
    repos: parsed.map((repo) => ({
      name: repo.name,
      private: repo.private === true,
      archived: repo.archived === true,
      description: repo.description ?? '',
    })),
  }
}

async function listRepos(name) {
  // 三种来源都走网络，代理链路抖动时可能同时失败：整轮重试一次再认输
  const reasons = []
  for (let round = 0; round < 2; round += 1) {
    try {
      return { repos: listReposWithGh(name), via: 'gh（含私有仓库）' }
    } catch (error) {
      const reason = error?.stderr?.toString().trim().split('\n')[0] || describeError(error)
      if (round === 0) reasons.push(`gh: ${reason}`)
    }
    const html = await listReposFromHtml(name)
    if (html.repos !== undefined) {
      return { repos: html.repos, via: '仓库列表页（仅公开仓库）', ghReason: reasons[0] }
    }
    if (round === 0) reasons.push(`列表页: ${html.error}`)
    const api = await listReposFromApi(name)
    if (api.repos !== undefined) return { repos: api.repos, via: 'GitHub REST', ghReason: reasons[0] }
    if (round === 0) reasons.push(`REST: ${api.error}`)
    if (round === 0) await sleep(1500)
  }
  return { error: reasons.join(' / ') }
}

async function readManifest(slug, ref, subPath) {
  const location = subPath === undefined || subPath === ''
    ? ref
    : `${ref}/${subPath.replace(/^\/+|\/+$/g, '')}`
  const { text, error } = await readText(
    `https://raw.githubusercontent.com/${slug}/${location}/package.json`,
  )
  if (error !== undefined) return { error }
  try {
    return { manifest: JSON.parse(text) }
  } catch {
    return { error: 'package.json 非 JSON' }
  }
}

/** HEAD 的 40 位 SHA；ls-remote 不走 REST，不受匿名 60 次/小时限制 */
function headSha(slug) {
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt += 1) {
    try {
      const out = execFileSync('git', ['ls-remote', `https://github.com/${slug}`, 'HEAD'], {
        encoding: 'utf8',
        timeout: 45_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const sha = out.split(/\s+/)[0]
      if (/^[0-9a-f]{40}$/.test(sha)) return sha
    } catch {
      /* 重试 */
    }
  }
  return null
}

/** HEAD 提交时间：`.patch` 头里的 Date 不需要 REST 配额 */
async function headCommitTime(slug, sha) {
  const { text, error } = await readText(`https://github.com/${slug}/commit/${sha}.patch`)
  if (error !== undefined) return null
  const match = /^Date:\s*(.+)$/m.exec(text)
  if (match === null) return null
  const stamp = Math.floor(new Date(match[1]).getTime() / 1000)
  return Number.isFinite(stamp) ? stamp : null
}

/** Release 的发布时间优先于提交时间：索引的 publishTimestamp 语义就是「发布时刻」 */
async function releaseTime(slug, version) {
  const { text, error } = await readText(`https://github.com/${slug}/releases.atom`)
  if (error !== undefined) return null
  for (const entry of text.match(/<entry>[\s\S]*?<\/entry>/g) ?? []) {
    const tag = /releases\/tag\/([^"<]+)/.exec(entry)?.[1]
    if (tag === undefined) continue
    const cleaned = decodeURIComponent(tag).replace(/^v/i, '')
    if (cleaned !== version) continue
    const updated = /<updated>([^<]+)<\/updated>/.exec(entry)?.[1]
    if (updated === undefined) continue
    const stamp = Math.floor(new Date(updated).getTime() / 1000)
    if (Number.isFinite(stamp)) return stamp
  }
  return null
}

async function pinOf(slug, version) {
  const sha = headSha(slug)
  if (sha === null) return { error: '取不到 HEAD 提交' }
  const released = await releaseTime(slug, version)
  if (released !== null) return { sha, timestamp: released, from: 'Release 发布时间' }
  const committed = await headCommitTime(slug, sha)
  if (committed === null) return { sha, timestamp: null, from: 'commit 时间读取失败' }
  // 只能在 HEAD 上取时间：找真正的 bump 提交要拉历史，代价远超这个脚本的定位。
  // 版本发布后若还有文档提交，这里会偏晚几分钟——写进索引前肉眼核一下。
  return { sha, timestamp: committed, from: 'HEAD 提交时间（该版本后若有提交会偏晚）' }
}

// ---------- 索引对照 ----------

const index = JSON.parse(await readFile(new URL('../index.json', import.meta.url), 'utf8'))
/** 一个仓库可能有多条收录（monorepo 多包），按 repository.url 分组 */
const indexed = new Map()
for (const plugin of index.plugins) {
  const url = plugin.repository?.url ?? ''
  const slug = url
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
    .toLowerCase()
  if (slug === '') continue
  const list = indexed.get(slug) ?? []
  list.push(plugin)
  indexed.set(slug, list)
}

// ---------- 扫描 ----------

const listed = await listRepos(owner)
if (listed.repos === undefined) {
  console.error(`扫描 ${owner} 失败：${listed.error}`)
  process.exit(2)
}

const repos = listed.repos
  .filter((repo) => repo.name.toLowerCase() !== 'plugbox' || owner.toLowerCase() !== 'wcof')
  .sort((a, b) => a.name.localeCompare(b.name))

const report = {
  owner,
  via: listed.via,
  total: repos.length,
  pending: [],
  candidate: [],
  current: [],
  ahead: [],
  workspace: [],
  private: [],
  archived: [],
  nonPlugin: [],
  unreadable: [],
}

for (const repo of repos) {
  if (repo.private) {
    report.private.push({ repo: repo.name })
    continue
  }
  if (repo.archived) {
    report.archived.push({ repo: repo.name })
    continue
  }
  const slug = `${owner}/${repo.name}`
  const known = indexed.get(slug.toLowerCase()) ?? []
  // 已收录的 monorepo 知道包在哪个子目录；未收录的只能看仓库根
  const subPath = known[0]?.versions?.[0]?.source?.path

  const { manifest, error } = await readManifest(slug, 'HEAD', subPath)
  if (manifest === undefined) {
    if (error === 'HTTP 404') {
      // 根没有清单：可能是 monorepo，也可能是纯文档/skill 仓库
      const rootProbe = subPath === undefined ? undefined : await readManifest(slug, 'HEAD', undefined)
      if (rootProbe?.manifest?.workspaces !== undefined || rootProbe?.manifest?.private === true) {
        report.workspace.push({ repo: slug, note: '根清单无 dsh.bundle，可能是 monorepo，需人工看子目录' })
      } else {
        report.nonPlugin.push({ repo: slug, note: '无 package.json' })
      }
    } else {
      report.unreadable.push({ repo: slug, note: error })
    }
    continue
  }

  if (manifest.dsh?.bundle === undefined) {
    if (manifest.workspaces !== undefined) {
      report.workspace.push({ repo: slug, note: 'workspaces 仓库，包在子目录' })
    } else {
      report.nonPlugin.push({ repo: slug, note: '未声明 dsh.bundle' })
    }
    continue
  }

  const upstreamVersion = manifest.version
  const enginesDsh = typeof manifest.engines?.dsh === 'string' ? manifest.engines.dsh : undefined
  const entry = {
    repo: slug,
    name: manifest.name ?? repo.name,
    version: upstreamVersion,
    enginesDsh,
    path: subPath,
  }

  if (known.length === 0) {
    report.candidate.push({ ...entry, indexedVersion: undefined })
    continue
  }

  const plugin = known[0]
  const indexVersion = plugin.versions[0]?.version
  entry.indexedVersion = indexVersion
  entry.indexedName = plugin.name
  if (typeof indexVersion !== 'string' || typeof upstreamVersion !== 'string') {
    report.unreadable.push({ repo: slug, note: '版本号缺失，无法比较' })
    continue
  }
  const comparison = compareVersions(upstreamVersion, indexVersion)
  if (comparison > 0) report.pending.push(entry)
  else if (comparison < 0) report.ahead.push(entry)
  else report.current.push(entry)
}

// ---------- 输出 ----------

const stamp = (seconds) =>
  seconds === null || seconds === undefined
    ? '—'
    : new Date(seconds * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })

if (wantPin || wantJson || outPath !== undefined) {
  for (const group of [report.pending, report.candidate]) {
    for (const item of group) {
      item.pin = await pinOf(item.repo, item.version)
    }
  }
}

if (outPath !== undefined) {
  await writeFile(outPath, JSON.stringify(report, null, 2))
  const actionable = report.pending.length + report.candidate.length
  console.log(`已写入 ${outPath}（${actionable} 项待处理，${report.total} 个仓库）`)
} else if (wantJson) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`扫描 ${owner}：${report.total} 个仓库（来源：${report.via}）\n`)

  const section = (title, items, render) => {
    console.log(`${title}  ${items.length}`)
    for (const item of items) console.log(`  ${render(item)}`)
    if (items.length > 0) console.log('')
  }

  section('待收录（索引落后于上游）', report.pending, (item) => {
    const where = item.path === undefined ? '' : `  path: '${item.path}'`
    const line = `${String(item.indexedName ?? item.name).padEnd(30)} 索引 ${item.indexedVersion} → 上游 ${item.version}  ${item.repo}${where}`
    if (item.pin?.sha === undefined) return line
    const note = item.pin.timestamp === null
      ? `${item.pin.from}，需手工确认时间戳`
      : `${item.pin.from} · ${stamp(item.pin.timestamp)}`
    return `${line}\n      commit: '${item.pin.sha}'  publishTimestamp: ${item.pin.timestamp ?? '?'}  // ${note}`
  })

  section('未收录候选（声明 dsh.bundle，索引里没有）', report.candidate, (item) => {
    const where = item.path === undefined ? '' : `  path: '${item.path}'`
    const line = `${String(item.name).padEnd(30)} v${item.version}  ${item.repo}${where}  engines.dsh: ${item.enginesDsh ?? '(未声明)'}`
    if (item.pin?.sha === undefined) return line
    const note = item.pin.timestamp === null
      ? `${item.pin.from}，需手工确认时间戳`
      : `${item.pin.from} · ${stamp(item.pin.timestamp)}`
    return `${line}\n      commit: '${item.pin.sha}'  publishTimestamp: ${item.pin.timestamp ?? '?'}  // ${note}`
  })

  section('索引比上游还新（大概率是预发布或回滚，核对一下）', report.ahead, (item) =>
    `${String(item.indexedName ?? item.name).padEnd(30)} 索引 ${item.indexedVersion} ← 上游 ${item.version}  ${item.repo}`,
  )

  section('可能是 monorepo（需人工确认子目录）', report.workspace, (item) => `${item.repo} —— ${item.note}`)
  section('读取失败（网络，未定论）', report.unreadable, (item) => `${item.repo} —— ${item.note}`)

  console.log(`已是最新  ${report.current.length}`)
  console.log(
    `跳过：私有 ${report.private.length}（公开索引收不了）/ 归档 ${report.archived.length} / 非插件 ${report.nonPlugin.length}\n`,
  )
  if (report.private.length > 0) {
    console.log(`私有仓库：${report.private.map((item) => item.repo).join('、')}`)
  }
  const actionable = report.pending.length + report.candidate.length
  console.log(
    actionable === 0
      ? '没有待处理项：索引与上游一致。'
      : `共 ${actionable} 项待处理。加 --pin 可解析提交与发布时间，直接给出 VERSION_SOURCES 片段。`,
  )
}

if (strict && report.pending.length + report.candidate.length > 0) process.exitCode = 1
