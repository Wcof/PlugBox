/**
 * 仓库分支基线的持久化存储：检查更新的「分支场景」判定依据。
 *
 * 事实状态（装了什么、什么版本）在宿主，这里只存面板侧的对比锚点——
 * 安装时与检查更新时看到的分支名集合和头提交。没有它，面板重开后第一次
 * 检查更新就没有基线，上游对所装分支的推送会漏检。
 *
 * localStorage 写失败（禁用存储、隐私模式）时静默降级为内存 Map：
 * 功能在单次会话内仍然成立，只是跨会话的基线没了。
 */

const STORAGE_KEY = 'plugbox.branch-baselines.v1'

export type BaselineOrigin = 'install' | 'check'

export interface RepoBaseline {
  names: string[]
  heads: Record<string, string | null>
  /** 记录时间（Unix 毫秒） */
  recordedAt: number
  origin: BaselineOrigin
}

const memory = new Map<string, RepoBaseline>()

function isBaseline(value: unknown): value is RepoBaseline {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Partial<RepoBaseline>
  return (
    Array.isArray(record.names) &&
    record.names.every((name) => typeof name === 'string') &&
    typeof record.heads === 'object' &&
    record.heads !== null &&
    typeof record.recordedAt === 'number' &&
    (record.origin === 'install' || record.origin === 'check')
  )
}

function readAll(): Record<string, RepoBaseline> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed === 'object' && parsed !== null) {
        const filtered: Record<string, RepoBaseline> = {}
        for (const [repo, baseline] of Object.entries(parsed as Record<string, unknown>)) {
          if (isBaseline(baseline)) filtered[repo] = baseline
        }
        return filtered
      }
    }
  } catch {
    // 解析失败 / 存储不可用：退回内存
  }
  return Object.fromEntries(memory)
}

function writeAll(all: Record<string, RepoBaseline>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch {
    // 存储不可用：写内存兜底
  }
  memory.clear()
  for (const [repo, baseline] of Object.entries(all)) memory.set(repo, baseline)
}

export function getRepoBaseline(repo: string): RepoBaseline | null {
  return readAll()[repo] ?? null
}

export function putRepoBaseline(
  repo: string,
  snapshot: { names: string[]; heads: Record<string, string | null> },
  origin: BaselineOrigin,
): void {
  const all = readAll()
  all[repo] = { ...snapshot, recordedAt: Date.now(), origin }
  writeAll(all)
}

export function removeRepoBaseline(repo: string): void {
  const all = readAll()
  if (!(repo in all)) return
  delete all[repo]
  writeAll(all)
}
