import { activeAdapter } from '../adapters/registry'
import { compareVersions as compare } from '../core/protocol/version'

/** 插件管理 Tab 的来源筛选 */
export type LocalFilter = 'all' | 'official' | 'third-party' | 'local'
/** 插件市场 Tab 的筛选 */
export type StoreFilter =
  | 'all'
  | 'official'
  | 'catalog'
  | 'third-party'
  | 'installed'
  | 'available'
export type LocalSortKey = 'status' | 'name' | 'package' | 'origin'
export type StoreSortKey = 'index' | 'name' | 'author' | 'installable'

/** 组合包来源：宿主的 official 标记优先，其余按安装来源前缀区分本地目录与远程包 */
export type BundleOrigin = 'official' | 'third-party' | 'local'

const LOCAL_SOURCE_PATTERN = /^(?:link|file|workspace|directory):|^(\.{1,2}\/|\/|~\/|[a-z]:[\\/])/i

/** 当前宿主：宿主叫什么、它的包挂在哪个 scope 下，答案都从这里出 */
export const HOST = activeAdapter()

/** 当前宿主的名字：界面上凡是「某个引擎」的地方都用它，不要再写死宿主名 */
export const HOST_NAME = HOST.displayName

/** 版本比较实现迁到 core 了，这里保留同名导出，免得调用方都跟着改 */
export const compareVersions = compare

/** 宿主自带的包挂在这个 npm scope 下；宿主的 official 标记只表示「随安装附带」 */
export function bundleOrigin(bundle: { name: string; official: boolean; source?: string }): BundleOrigin {
  const scopes = HOST.vendorPackageScopes
  if (bundle.official || scopes.some((scope) => bundle.name.startsWith(scope))) return 'official'
  return LOCAL_SOURCE_PATTERN.test((bundle.source ?? '').trim()) ? 'local' : 'third-party'
}

export const BUNDLE_ORIGIN_LABEL: Record<BundleOrigin, string> = {
  official: '官方插件',
  'third-party': '第三方插件',
  local: '本地安装',
}

export const BUNDLE_ORIGIN_TAG: Record<BundleOrigin, string> = {
  official: 'tag--green',
  'third-party': 'tag--blue',
  local: 'tag--gray',
}

/**
 * 收录来源：宿主的官方标记优先，其次看是不是本 Box 的索引收录，其余一律第三方。
 * 文案取自当前适配器，所以换宿主时这三句话自动跟着变。
 */
export type MarketLabel = 'official' | 'catalog' | 'third-party'

export const MARKET_LABEL_TEXT: Record<MarketLabel, string> = {
  official: HOST.labels.vendor,
  catalog: HOST.labels.curated,
  'third-party': HOST.labels.thirdParty,
}

export const MARKET_LABEL_TAG: Record<MarketLabel, string> = {
  official: 'tag--green',
  catalog: 'tag--blue',
  'third-party': 'tag--gray',
}

/** 索引里的分类键 → 展示名（与 pluginIndex 的 CATEGORIES 对应） */
export const MARKET_CATEGORY_LABEL: Record<string, string> = {
  reading: '阅读',
  learning: '学习',
  productivity: '效率',
  ui: '界面增强',
  tools: '工具',
  models: '模型与供应商',
}

/** 从仓库地址里取 owner/name，只认 GitHub；拿不到就返回 null */
export function githubRepoOf(...urls: Array<string | undefined>): string | null {
  for (const url of urls) {
    if (url === undefined) continue
    const match = /github\.com\/([^/]+)\/([^/#?]+)/i.exec(url)
    if (match !== null) return `${match[1]}/${match[2].replace(/\.git$/, '')}`
  }
  return null
}

/** 组合包在磁盘上的可读位置：profile 依赖、随安装附带、或已缺失 */
export type BundleAvailability = 'profile' | 'installation' | 'missing'

export type ReadOnlyReason = 'management-required' | 'unaddressable'

/** 组合包内的一行 Loader 插件 */
export interface PluginRow {
  rowId: string
  moduleName: string
  /** Loader 条目身份，来自 listPlugins；缺失时该行不可单独启停 */
  entryId?: string
  title: string
  description: string
  enabled: boolean
  fiberPhase: 'failed' | 'pending' | 'active' | 'loading' | 'unloading' | null
  readOnlyReason?: ReadOnlyReason
}

export interface BundleError {
  code: string
  diagnostic?: string
}

/** 已安装（或被随附）的组合包，数据取自宿主的插件管理服务 */
export interface InstalledBundle {
  /** 包名，唯一标识 */
  name: string
  title: string
  description: string
  version?: string
  /** 包内导出的图标，data: URL */
  icon?: string
  enabled: boolean
  installed: boolean
  availability: BundleAvailability
  official: boolean
  optional: boolean
  removable: boolean
  readOnlyReason?: ReadOnlyReason
  /** profile 里保存的安装来源（git / 本地路径等） */
  source?: string
  error?: BundleError
  rows: PluginRow[]
  /** 检查更新后填充 */
  latestVersion?: string
  updateSpec?: string
}

export interface MarketVersion {
  version: string
  spec: string
  registry?: string
  compatible: boolean
  requirements?: Record<string, string>
}

/** 索引源里的一个插件，数据取自宿主的插件市场服务 */
export interface MarketEntry {
  name: string
  title: string
  description: string
  icon?: string
  author?: string
  homepage?: string
  repository?: string
  category?: string
  keywords: string[]
  labels: string[]
  label: MarketLabel
  defaultVersion?: string
  versions: MarketVersion[]
  installation: {
    status: 'not-installed' | 'installed' | 'update-available' | 'different-version' | 'provided'
    installedVersion?: string
  }
  indexUrl: string
  indexTitle: string
}

export interface MarketIndexSummary {
  url: string
  title?: string
  error?: string
}

/** 插件仓库里的一个分支：按分支安装时给用户挑，不是 commit 选择器 */
export interface RepoBranch {
  name: string
  /** 分支头提交，仅作信息展示 */
  commit?: string | null
  version?: string | null
  enginesDsh?: string | null
  /** 该分支的 package.json 是否声明了 dsh.bundle */
  bundle: boolean
  /** 分支自己的展示名与描述：不同分支可能不一样 */
  title?: string | null
  description?: string | null
}

/**
 * 检查更新发现的仓库分支变更。
 * 分支是上游的活口，不在索引里登记版本号，所以只能靠 repoBranches 读出来；
 * 这里只记录并提醒，不自动安装——换分支属于用户主动决策。
 */
export interface BranchUpdate {
  /** 已装组合包名 */
  name: string
  title: string
  repo: string
  branch: string
  /** 该分支 package.json 里的版本，可能没有 */
  version?: string
  /** 分支版本比当前已装版本高 */
  newer: boolean
  /** new：上次检查后新出现的分支；head：所装分支的头提交变了；version：分支上有更高版本 */
  reason: 'new' | 'head' | 'version'
  /** 供跳转到市场卡片按分支安装 */
  spec: string
}

/** 启停 / 删除 / 安装这类操作的统一结果 */
export interface OperationResult {
  changed: boolean
  application: 'cancelled' | 'failed' | 'applied' | 'restart-required' | 'overridden'
  stage: 'remove' | 'install' | 'enable'
  target: string
  enabled?: boolean
  restartReason?: string
  error?: BundleError & { message?: string }
  warnings?: string[]
}

/** 通知条类型 */
export type ToastType = 'success' | 'info' | 'warning' | 'error'

export interface Toast {
  id: number
  type: ToastType
  text: string
}

/** 作者展示：full 显示 “id（中文名）”，否则优先中文名 */
export function authorLabel(author: string, authorName?: string, full = false): string {
  if (!authorName) return author
  return full ? `${author}（${authorName}）` : authorName
}
