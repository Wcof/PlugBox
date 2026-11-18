/**
 * 分支差分：检查更新的「分支场景」判定，宿主无关的纯函数。
 *
 * 分支不登记进索引、也没有发布版本；判断「上游是否有新内容」只能拿仓库分支扫描
 * 结果和一个基线快照比。基线的两个来源都算数：
 * - 安装时记录的快照（面板装完插件就记，持久化，跨会话有效）；
 * - 上一次检查更新记录的快照（零变更的仓库才推进，有变更就保留，提醒持续可见）。
 *
 * 没有「发布时间」可查（逐分支查提交日期要打 GitHub REST，容易限流），所以
 * 「发布时间晚于当前版本或分支」用头提交 SHA 与基线的差异来表达：基线之后的
 * 推送、新建分支，都是基线不存在的内容。
 */

import { compareVersions } from '../protocol/version'

/** 基线快照：某仓库在某个时点的全部分支名与头提交 */
export interface BranchBaselineSnapshot {
  names: string[]
  heads: Record<string, string | null>
}

/** 一次仓库分支扫描的最小结构（与宿主 repoBranches 的返回字段对齐） */
export interface BranchScan {
  name: string
  commit?: string | null
  version?: string | null
  bundle: boolean
}

export interface BranchDiffInput {
  /** 基线快照；null 表示第一次见到这个仓库（诚实起见只报版本抬升） */
  baseline: BranchBaselineSnapshot | null
  branches: BranchScan[]
  /** 已装来源里的 #ref（分支安装才有；版本安装为空） */
  installedRef: string
  /** 已装版本号，缺失时无法比较版本 */
  installedVersion?: string
}

export interface BranchFinding {
  branch: string
  version?: string
  /** 分支版本比当前已装版本高 */
  newer: boolean
  /** head：所装分支的头提交变了；new：基线之后新出现的分支；version：分支上有更高版本 */
  reason: 'new' | 'head' | 'version'
}

/**
 * 比对基线与本次扫描，输出更新发现（每个分支最多一条）。
 *
 * 三类发现：所装分支头提交变了（head）、基线之后新出现的分支（new）、
 * 任一分支版本号高于已装版本（version，包括所装分支自身被抬升——那也是上游的更新）。
 * 不会误报：基线里就存在的同头提交分支、版本更低的旧分支、没声明组合包的分支，都不报。
 */
export function diffBranches(input: BranchDiffInput): BranchFinding[] {
  const { baseline, branches, installedRef, installedVersion } = input
  const findings: BranchFinding[] = []
  for (const branch of branches) {
    if (!branch.bundle) continue
    const baselineHead = baseline?.heads[branch.name]
    const isNew = baseline !== null && !baseline.names.includes(branch.name)
    // 上次没读到头提交（或本次没读到）时不能凭空断言上游推了新提交
    const headMoved =
      baseline !== null &&
      branch.name === installedRef &&
      typeof baselineHead === 'string' &&
      typeof branch.commit === 'string' &&
      baselineHead !== branch.commit
    const newer =
      typeof branch.version === 'string' &&
      typeof installedVersion === 'string' &&
      compareVersions(branch.version, installedVersion) > 0
    if (!isNew && !headMoved && !newer) continue
    findings.push({
      branch: branch.name,
      version: branch.version ?? undefined,
      newer,
      reason: headMoved ? 'head' : isNew ? 'new' : 'version',
    })
  }
  return findings
}

/** 从一次扫描构造基线快照：记录全部分支（含未声明组合包的，它们以后声明了才算「新出现」） */
export function baselineFromScan(branches: BranchScan[]): BranchBaselineSnapshot {
  return {
    names: branches.map((branch) => branch.name),
    heads: Object.fromEntries(branches.map((branch) => [branch.name, branch.commit ?? null])),
  }
}

/**
 * 版本串必须先过筛：`compareVersions` 对无法解析的串会退化成 0.0.0，
 * 不筛一遍会把分支名之类的噪音当成「0 版本」。
 */
const SEMVER_LIKE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

export interface IndexLagInput {
  /** 索引里该插件登记的默认版本；缺省表示索引条目不完整，无法比较 */
  indexVersion?: string
  branches: BranchScan[]
}

export interface IndexLagFinding {
  /** 索引当前登记的版本 */
  indexVersion: string
  /** 分支里声明的最高版本 */
  upstreamVersion: string
  /** 该版本所在的分支 */
  branch: string
}

/**
 * 索引收录是否落后于上游：比较「索引登记的版本」与「仓库分支里声明的最高版本」。
 *
 * 这是货架的问题，不是用户的问题——面板更新只能装索引里有的版本，所以这个结论
 * 不进可更新列表，只用来解释「明明上游已经发版，为什么市场不提示」。
 * 未声明 `dsh.bundle` 的分支装不成组合包，不能当作上游有版的证据。
 */
export function indexLagBetween(input: IndexLagInput): IndexLagFinding | null {
  const { indexVersion, branches } = input
  if (typeof indexVersion !== 'string' || !SEMVER_LIKE.test(indexVersion)) return null
  let best: { version: string; branch: string } | null = null
  for (const branch of branches) {
    const version = typeof branch.version === 'string' ? branch.version : undefined
    if (version === undefined || !branch.bundle || !SEMVER_LIKE.test(version)) continue
    if (best === null || compareVersions(version, best.version) > 0) {
      best = { version, branch: branch.name }
    }
  }
  if (best === null || compareVersions(best.version, indexVersion) <= 0) return null
  return { indexVersion, upstreamVersion: best.version, branch: best.branch }
}
