import { computed, reactive } from 'vue'
import type {
  BranchUpdate,
  BundleOrigin,
  InstalledBundle,
  LocalFilter,
  LocalSortKey,
  MarketEntry,
  MarketIndexSummary,
  OperationResult,
  RepoBranch,
  StoreFilter,
  StoreSortKey,
  Toast,
  ToastType,
} from '../types/plugin'
import { bundleOrigin, githubRepoOf, MARKET_CATEGORY_LABEL, HOST } from '../types/plugin'
import { compareVersions } from '../core/protocol/version'
import { baselineFromScan, diffBranches } from '../core/lifecycle/branch-diff'
import { getRepoBaseline, putRepoBaseline } from './branchBaseline'
import { BRAND } from '../core/protocol/brand'
import { hostRequirementOf } from '../core/manifest'
import * as service from '../services/pluginService'
import { isPinnedIndex } from '../data/pinnedIndex'

export type TabKey = 'local' | 'store'
type ListStatus = 'loading' | 'ready' | 'error'

interface ConfirmOptions {
  title: string
  message: string
  confirmText?: string
  danger?: boolean
}

/** 本 Box 发布的索引源，供「一键订阅」使用 */
const SELF_INDEX_URL = 'https://raw.githubusercontent.com/Wcof/PlugBox/main/index.json'

/**
 * 社区目录：从 dsh-plugin.org 同步的 5,000+ 条，逐条做过仓库级核实。
 * 单独发布、单独订阅——精选索引不掺沙子，需要全量的用户点一下就有。
 */
const COMMUNITY_INDEX_URL = 'https://raw.githubusercontent.com/Wcof/PlugBox/main/community.json'

/**
 * 插件中心唯一状态 owner：数据一律来自宿主侧的插件管理与插件市场服务（经适配器调用），
 * UI 只读 state 并调用 action，不持有任何本地副本。
 */
const state = reactive({
  activeTab: 'local' as TabKey,
  view: 'list' as 'list' | 'detail',
  detailName: null as string | null,

  bundles: [] as InstalledBundle[],
  market: [] as MarketEntry[],
  indexes: [] as MarketIndexSummary[],
  indexErrors: {} as Record<string, string>,
  indexTotals: {} as Record<string, number>,

  hostOnline: null as boolean | null,
  localStatus: 'loading' as ListStatus,
  storeStatus: 'loading' as ListStatus,
  /** 每次市场加载自增的请求令牌：晚到的响应比对不上就丢弃，避免覆盖新结果 */
  storeRequest: 0,
  /** 翻页进度，形如 "12/54"；已有列表时用它替代骨架屏 */
  storeProgress: '',
  /** 全库条数（上一次无关键词加载的结果）：搜索 0 结果时用它说明「已搜索全部 N 条」 */
  storeCorpusTotal: 0,

  localQuery: '',
  storeQuery: '',
  localFilter: 'all' as LocalFilter,
  storeFilter: 'all' as StoreFilter,
  /** 创作者多选，空数组表示不限；命中语义为「任一」 */
  storeAuthors: [] as string[],
  /** 分类多选（对应索引 metadata.category），空数组表示不限 */
  storeCategories: [] as string[],
  /** 社区目录有上千位作者，分面默认只显示前 12 位 */
  authorFacetsExpanded: false,
  localSort: 'status' as LocalSortKey,
  storeSort: 'index' as StoreSortKey,

  checkingUpdates: false,
  updatingAll: false,
  installOpen: false,
  /** 开发指南：内嵌弹窗，内容随本包构建，不跳外部站点 */
  devGuideOpen: false,
  /** 启动时静默检查出可更新后，用户点过「稍后」就收起提示条 */
  updateNoticeDismissed: false,
  /** 检查更新发现的分支变更：只提醒，不自动安装，也不会登记进索引 */
  branchUpdates: [] as BranchUpdate[],
  /** 索引里有更高版本、但默认版本与当前宿主不兼容：装不上，但不能假装没看见 */
  blockedUpdateCount: 0,
  /** 市场列表一次渲染多少条：社区目录有几千条，全渲染会卡住页面 */
  storeRenderLimit: 120,
  busy: {} as Record<string, boolean>,

  toasts: [] as Toast[],
  confirm: null as (ConfirmOptions & { resolve: (ok: boolean) => void }) | null,
})

let toastSeq = 0

function toast(type: ToastType, text: string): void {
  const id = ++toastSeq
  state.toasts.push({ id, type, text })
  setTimeout(() => dismissToast(id), 3800)
}

function dismissToast(id: number): void {
  const index = state.toasts.findIndex((t) => t.id === id)
  if (index >= 0) state.toasts.splice(index, 1)
}

function openConfirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    state.confirm = { ...options, resolve }
  })
}

function resolveConfirm(ok: boolean): void {
  state.confirm?.resolve(ok)
  state.confirm = null
}

async function withBusy<T>(key: string, fn: () => Promise<T>): Promise<T | undefined> {
  if (state.busy[key]) return undefined
  state.busy[key] = true
  try {
    return await fn()
  } finally {
    delete state.busy[key]
  }
}

const ERROR_TEXT: Record<string, string> = {
  'host-unreachable': `没连上宿主进程，请在${HOST.displayName}里打开${BRAND.name}`,
  'service-unavailable': '当前 profile 没有装载插件管理服务',
  'management-required': '这个包是插件管理所需，不能停用或卸载',
  unaddressable: '当前 profile 的 patch 无法唯一定位这一项',
  'unknown-plugin': '找不到这个插件',
  'invalid-spec': '包名或地址无法识别',
  'already-installed': '这个包已经安装；要换版本请先卸载',
  'not-bundle': '这个包没有声明组合包，不能作为插件管理',
  'not-removable': '这个包不属于当前 profile，或者是插件管理所需的组件',
  'stop-profile': '当前 profile 没有启用 HMR，无法在线卸载',
  'bundle-in-use': '还有配置在使用这个组合包的组件，请先停用它们',
  'stale-approval': '待允许的安装脚本列表已变化，请重新安装',
  'incompatible-version': `这个插件与当前${HOST.displayName}版本不兼容`,
  'github-rate-limited': 'GitHub 接口被限流了，过几分钟再试',
  'repo-unavailable': '找不到这个仓库或它没有可读的分支',
  'github-unavailable': '读不到 GitHub 上的分支',
  'operation-error': '宿主操作失败',
}

function describe(error: unknown): string {
  if (error instanceof service.PluginApiError) {
    const text = ERROR_TEXT[error.code] ?? error.message
    // 兼容性拒绝的 diagnostic 里带着具体未满足的版本要求，不要被固定文案吞掉
    if (error.code === 'incompatible-version' && error.message && error.message !== text) {
      return `${text}：${error.message}`
    }
    return text
  }
  return error instanceof Error ? error.message : '未知错误'
}

/** 操作结果里的失败原因优先用 code 翻成中文，其余按原文展示 */
function resultMessage(result: OperationResult): string | null {
  if (result.error) {
    const text = ERROR_TEXT[result.error.code] ?? result.error.code
    return result.error.diagnostic ? `${text}：${result.error.diagnostic}` : text
  }
  if (result.application === 'failed') return `操作在「${result.stage}」阶段失败`
  return null
}

function applyBundles(bundles: InstalledBundle[]): void {
  // 合并上一次检查更新得到的最新版本，避免刷新后标签消失
  const previous = new Map(state.bundles.map((bundle) => [bundle.name, bundle]))
  state.bundles = bundles.map((bundle) => {
    const known = previous.get(bundle.name)
    return known?.latestVersion && known.updateSpec
      ? { ...bundle, latestVersion: known.latestVersion, updateSpec: known.updateSpec }
      : bundle
  })
}

function withoutUpdate(bundle: InstalledBundle): InstalledBundle {
  const next = { ...bundle }
  delete next.latestVersion
  delete next.updateSpec
  return next
}

/**
 * 用索引数据给已装组合包打「可更新」标记。只读索引，不装任何东西；返回本次标记数量。
 *
 * 不能只认宿主给的 installation.status：按分支安装的包常被宿主标成
 * 'different-version'，索引升版后宿主的安装状态也可能滞后（仍是 'installed'），
 * 这两种情况下宿主都说「没更新」，可索引里明明已有新版本。所以再用本地实际版本
 * 与索引默认版本比一次，两条路径任一命中就算可更新。
 *
 * 默认版本与当前宿主版本不兼容时仍不打标记：宿主的安装前检查会拒掉它，
 * 提示「可更新」只会让人白点一次。
 *
 * 数据来源不全（搜索结果只是子集、某个索引源读失败）时，没查到的包保留原标记，
 * 不能因为「这轮没读到」就把已有的更新提示抹掉。
 */
function applyUpdateFlags(
  source: MarketEntry[] = state.market,
  options: { complete?: boolean } = {},
): number {
  const incompleteData =
    Object.keys(state.indexErrors).length > 0 || state.storeStatus === 'error'
  const complete =
    options.complete ?? (state.storeQuery.trim().length <= 1 && !incompleteData)
  const byName = new Map(source.map((entry) => [entry.name, entry]))
  let count = 0
  let blocked = 0
  state.bundles = state.bundles.map((bundle) => {
    const entry = byName.get(bundle.name)
    if (entry === undefined) return complete ? withoutUpdate(bundle) : bundle
    const target = entry.versions.find((version) => version.version === entry.defaultVersion)
    if (entry.defaultVersion === undefined || target === undefined) return withoutUpdate(bundle)
    const installed = bundle.version ?? entry.installation.installedVersion
    const newer = installed !== undefined && compareVersions(target.version, installed) > 0
    if (target.compatible === false) {
      // 看得见但装不上：单独计数，检查更新时如实提醒，不能当成「没有更新」
      if (newer) blocked += 1
      return withoutUpdate(bundle)
    }
    if (!newer && entry.installation.status !== 'update-available') return withoutUpdate(bundle)
    count += 1
    return {
      ...withoutUpdate(bundle),
      latestVersion: target.version,
      updateSpec: target.spec,
    }
  })
  // 数据不全（搜索子集 / 索引读失败）时保留上一次的计数，别一次失败就清零
  if (complete) state.blockedUpdateCount = blocked
  return count
}

// ============ 加载 ============

/** 宿主 search 单页上限 100，且必须靠 nextOffset 翻页才能拿全一个索引 */
const MARKET_PAGE_SIZE = 100
/** 社区目录有 5,000+ 条，上限放到 60 页（6,000 条）；超出才在列表上方提示 */
const MARKET_MAX_PAGES = 60
/** 首页之后的翻页并发数：串行 55 页要等十几秒 */
const MARKET_PAGE_CONCURRENCY = 6
/** 搜索只取第 1 页：几千条里翻 60 页只为凑满一屏没有意义 */
const SEARCH_PAGE_SIZE = 100
/** 首页不足以覆盖全部命中时，延迟一次完整翻页把结果补齐 */
const SEARCH_DEEP_DELAY = 600

let searchTimer: ReturnType<typeof setTimeout> | undefined
let deepSearchTimer: ReturnType<typeof setTimeout> | undefined

/**
 * 上一次「无关键词」加载的结果：清空搜索时直接换回来，
 * 不必再为「把列表还给我」多发一轮请求。
 */
let fullMarket: MarketEntry[] = []
let fullIndexTotals: Record<string, number> = {}

/** 有没有一轮加载正在跑：作废它之后才知道要不要补发（见 cancelStoreSearch） */
let storeLoadInFlight = false

/**
 * token 为 null 表示「检查更新」这类独立读取：它不接管市场列表，
 * 因此既不参与 storeRequest 竞态，也不该覆盖市场列表的翻页进度。
 */
function isCurrent(token: number | null): boolean {
  return token === null || token === state.storeRequest
}

/** 只有本次请求仍是当前请求时才写进度，被取代的翻页不再刷界面 */
function reportProgress(token: number | null, done: number, total: number): void {
  if (token !== null && isCurrent(token)) state.storeProgress = `${done}/${total}`
}

async function fetchIndexPages(
  url: string,
  refresh: boolean,
  token: number | null,
  text: string = state.storeQuery,
): Promise<{ entries: MarketEntry[]; total: number }> {
  const query = { text, limit: MARKET_PAGE_SIZE }
  const first = await service.searchIndex(url, { ...query, offset: 0, refresh })
  const total = first.total
  const fetchedAt = first.fetchedAt

  // 按页号存，最后按顺序拼回去：并发请求不能打乱「索引顺序」
  const pages: MarketEntry[][] = [first.entries]
  const nextOffset = first.nextOffset ?? 0
  const hasMore = first.nextOffset !== null && first.entries.length < total
  const remaining = hasMore
    ? Math.min(Math.ceil((total - nextOffset) / MARKET_PAGE_SIZE), MARKET_MAX_PAGES - 1)
    : 0

  const totalPages = 1 + remaining
  reportProgress(token, 1, totalPages)

  if (remaining > 0) {
    let cursor = 0
    let done = 1
    const fetchPage = async (): Promise<void> => {
      while (cursor < remaining) {
        // 请求已被新的输入/刷新取代时就停手，别把剩下的页也拉下来
        if (token !== null && !isCurrent(token)) return
        const page = cursor++
        const result = await service.searchIndex(url, {
          ...query,
          offset: nextOffset + page * MARKET_PAGE_SIZE,
          // 同一份文档的后续页用首次读取时间固定，避免翻页时文档被换掉导致漏条或重条
          fetchedAt,
        })
        pages[page + 1] = result.entries
        done += 1
        reportProgress(token, done, totalPages)
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(MARKET_PAGE_CONCURRENCY, remaining) }, fetchPage),
    )
  }

  return { entries: pages.flatMap((page) => page ?? []), total }
}

/** 不带关键词的加载才算「完整列表」，清空搜索时用它还原 */
function rememberFullMarket(): void {
  if (state.storeQuery.trim().length > 1) return
  fullMarket = state.market
  fullIndexTotals = { ...state.indexTotals }
  // 搜索返回的 total 是命中数，全库基数只能从这次无关键词的加载里记
  state.storeCorpusTotal = Math.max(
    Object.values(fullIndexTotals).reduce((sum, n) => sum + n, 0),
    fullMarket.length,
  )
}

async function loadLocal(): Promise<void> {
  state.localStatus = 'loading'
  try {
    const bundles = await service.listBundles()
    applyBundles(bundles)
    state.hostOnline = true
    state.localStatus = 'ready'
  } catch (error) {
    state.hostOnline = false
    state.localStatus = 'error'
    state.indexErrors = {}
    console.warn('[plugbox] listBundles failed:', describe(error))
  }
}

async function loadStore(refresh = false): Promise<void> {
  // 完整加载接管之后，之前排队的「补齐搜索结果」就不必跑了
  if (deepSearchTimer) {
    clearTimeout(deepSearchTimer)
    deepSearchTimer = undefined
  }
  const token = ++state.storeRequest
  storeLoadInFlight = true
  resetStoreRenderLimit()
  state.storeStatus = 'loading'
  state.indexErrors = {}
  state.indexTotals = {}
  state.storeProgress = ''
  try {
    const indexes = await service.listIndexes()
    if (!isCurrent(token)) return
    state.indexes = indexes
    if (indexes.length === 0) {
      state.market = []
      state.storeStatus = 'ready'
      applyUpdateFlags()
      return
    }

    const collected: MarketEntry[] = []
    for (const index of indexes) {
      if (index.error) {
        state.indexErrors[index.url] = index.error
        continue
      }
      try {
        const { entries, total } = await fetchIndexPages(index.url, refresh, token)
        if (!isCurrent(token)) return
        collected.push(...entries)
        state.indexTotals[index.url] = total
      } catch (error) {
        if (!isCurrent(token)) return
        state.indexErrors[index.url] = describe(error)
      }
    }
    if (!isCurrent(token)) return
    state.market = collected
    rememberFullMarket()
    state.storeStatus = 'ready'
    state.storeProgress = ''
    applyUpdateFlags()
  } catch (error) {
    if (!isCurrent(token)) return
    state.storeStatus = 'error'
    state.storeProgress = ''
    console.warn('[plugbox] listIndexes failed:', describe(error))
  } finally {
    // 只有仍是当前时才交还「在途」标记：已经作废的这次不该替后来者清账
    if (isCurrent(token)) storeLoadInFlight = false
  }
}

async function init(): Promise<void> {
  // 打开即静默比一次版本：只标记「可更新」，装不装由用户决定。
  await Promise.all([loadLocal(), loadStore()])
  applyUpdateFlags()
  // 自身更新不依赖订阅：自家索引没被订阅也要比一次，插件中心自己有新版就照常提示。
  // 合并已订阅条目后再比对，避免 complete 模式把其他源的更新标记抹掉。
  try {
    if (!(await service.listIndexes()).some((index) => index.url === SELF_INDEX_URL)) {
      const { entries } = await fetchIndexPages(SELF_INDEX_URL, true, null, '')
      mergeUpdateSnapshot(entries)
      applyUpdateFlags([...state.market, ...entries], { complete: true })
    }
  } catch (error) {
    console.warn('[plugbox] init: self index failed:', describe(error))
  }
}

function dismissUpdateNotice(): void {
  state.updateNoticeDismissed = true
}

/** 只掐掉排队中的定时器，不动在途请求（切 tab 用这个，别把还在跑的加载作废） */
function clearStoreSearchTimers(): void {
  if (searchTimer) {
    clearTimeout(searchTimer)
    searchTimer = undefined
  }
  if (deepSearchTimer) {
    clearTimeout(deepSearchTimer)
    deepSearchTimer = undefined
  }
}

/**
 * 取消排队中的搜索，并让在途请求作废（新输入或完整加载会接管之后的状态）。
 *
 * 返回 true 表示「被作废的是一轮还在跑的加载，已替它补发一轮」——调用方据此决定
 * 要不要再自己调 loadStore，避免同一件事发两次请求。
 *
 * 为什么必须补发：作废掉的那次加载在每个 await 之后都会发现自己已过期并直接 return，
 * 再也不会回头把 storeStatus 写成 ready；没有替补的话列表就永远停在骨架屏上，
 * 用户只能手动点刷新。首次加载 5,413 条要翻 55 页，几秒的窗口很容易撞上。
 */
function cancelStoreSearch(): boolean {
  clearStoreSearchTimers()
  const wasLoading = storeLoadInFlight
  state.storeRequest += 1
  if (!wasLoading) return false
  void loadStore()
  return true
}

/** 商场搜索走后端索引匹配，输入停顿后再请求；真正取数交给 loadStoreSearch */
function scheduleStoreSearch(): void {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    searchTimer = undefined
    void loadStoreSearch()
  }, 260)
}

/** 把列表换回上一次完整加载的结果；没有快照（首次加载中）就交给完整加载 */
function restoreFullMarket(): void {
  resetStoreRenderLimit()
  state.storeProgress = ''
  if (fullMarket.length > 0) {
    state.market = fullMarket
    state.indexTotals = fullIndexTotals
    state.storeStatus = 'ready'
    return
  }
  if (state.storeStatus === 'loading') return
  void loadStore()
}

/**
 * 搜索只取第 1 页：几千条索引里翻满 60 页只为凑一屏没有意义。
 * 拿到 total 立刻更新列表；命中多于一页时再延迟补齐完整翻页。
 * 每次请求带自己的令牌，晚到的响应比对不上就丢弃——连续输入不会互相覆盖。
 */
async function loadStoreSearch(): Promise<void> {
  if (deepSearchTimer) {
    clearTimeout(deepSearchTimer)
    deepSearchTimer = undefined
  }
  const text = state.storeQuery.trim()
  if (text.length <= 1) {
    // 一两个字不搜：把搜索结果换回完整列表，列表才不会和输入框对不上
    restoreFullMarket()
    return
  }

  const token = ++state.storeRequest
  storeLoadInFlight = true
  state.storeStatus = 'loading'
  state.indexErrors = {}
  state.indexTotals = {}
  state.storeProgress = ''
  let deeper = false
  try {
    const indexes = await service.listIndexes()
    if (!isCurrent(token)) return
    state.indexes = indexes
    if (indexes.length === 0) {
      state.market = []
      state.storeStatus = 'ready'
      return
    }

    const collected: MarketEntry[] = []
    for (const index of indexes) {
      if (index.error) {
        state.indexErrors[index.url] = index.error
        continue
      }
      try {
        const page = await service.searchIndex(index.url, {
          text,
          limit: SEARCH_PAGE_SIZE,
          offset: 0,
        })
        if (!isCurrent(token)) return
        collected.push(...page.entries)
        state.indexTotals[index.url] = page.total
        // 命中超过一页：稍后用完整翻页补齐，先让用户看到第一屏
        if (page.total > page.entries.length) deeper = true
      } catch (error) {
        if (!isCurrent(token)) return
        state.indexErrors[index.url] = describe(error)
      }
    }
    if (!isCurrent(token)) return
    state.market = collected
    state.storeStatus = 'ready'
    applyUpdateFlags()
    if (deeper) {
      deepSearchTimer = setTimeout(() => {
        deepSearchTimer = undefined
        void loadStore()
      }, SEARCH_DEEP_DELAY)
    }
  } catch (error) {
    if (!isCurrent(token)) return
    state.storeStatus = 'error'
    console.warn('[plugbox] searchMarket failed:', describe(error))
  } finally {
    if (isCurrent(token)) storeLoadInFlight = false
  }
}

/** 清空搜索框（保留其他筛选）：先从快照换回完整列表，不再发请求 */
function clearStoreQuery(): void {
  // 先清关键词：替被作废的加载补发的那一轮要用新状态，否则又把结果搜回来了
  state.storeQuery = ''
  cancelStoreSearch()
  restoreFullMarket()
}

/** 订阅本 Box 的索引源（已有则忽略） */
async function subscribeSelfIndex(): Promise<void> {
  await withBusy('subscribe', async () => {
    try {
      const indexes = await service.listIndexes()
      if (indexes.some((index) => index.url === SELF_INDEX_URL)) {
        toast('info', `已经订阅过 ${BRAND.name} 索引源`)
        return
      }
      await service.setIndexes([...indexes.map((index) => index.url), SELF_INDEX_URL])
      toast('success', `已订阅 ${BRAND.name} 索引源`)
      await loadStore(true)
    } catch (error) {
      toast('error', `订阅失败：${describe(error)}`)
    }
  })
}

/** 订阅本 Box 的社区目录（条目多，订阅后首次加载会慢一些） */
async function subscribeCommunityIndex(): Promise<void> {
  await withBusy('subscribe', async () => {
    try {
      const indexes = await service.listIndexes()
      if (indexes.some((index) => index.url === COMMUNITY_INDEX_URL)) {
        toast('info', '已经订阅过社区目录')
        return
      }
      await service.setIndexes([...indexes.map((index) => index.url), COMMUNITY_INDEX_URL])
      toast('success', '已订阅社区目录：条目较多，搜索比翻列表快')
      await loadStore(true)
    } catch (error) {
      toast('error', `订阅失败：${describe(error)}`)
    }
  })
}

// ============ 更新 ============

/**
 * 检查更新专用的全量快照：强制刷新索引、不带搜索词、不接管市场列表。
 *
 * 原来直接复用 loadStore(true) 有两个漏报来源：它拿当前搜索词去取数，用户正在
 * 搜别的插件时检查范围就缩成了一个子集；在途搜索或补齐翻页还会自增 storeRequest
 * 把这次刷新作废，被作废的那轮在每个 await 后直接 return，applyUpdateFlags 根本
 * 没跑到，检查更新却照样汇总出 0 个更新并提示「已是最新」。检查更新必须走自己的取数路径。
 */
async function readMarketForUpdateCheck(): Promise<{ entries: MarketEntry[]; failed: string[] }> {
  const indexes = await service.listIndexes()
  const entries: MarketEntry[] = []
  const failed: string[] = []
  for (const index of indexes) {
    if (index.error !== undefined) {
      failed.push(index.url)
      continue
    }
    try {
      // token=null 不参与市场列表竞态；text='' 无论用户在搜什么都检查全库
      const { entries: page } = await fetchIndexPages(index.url, true, null, '')
      entries.push(...page)
    } catch (error) {
      failed.push(index.url)
      console.warn('[plugbox] checkUpdates: index failed:', index.url, describe(error))
    }
  }
  // 面板自己也是被安装的组合包：无论用户订阅了哪些源，检查更新都必须看一眼自家索引，
  // 否则「插件中心有新版」这件事只有在用户手动订阅之后才会被发现。
  if (!indexes.some((index) => index.url === SELF_INDEX_URL)) {
    try {
      const { entries: page } = await fetchIndexPages(SELF_INDEX_URL, true, null, '')
      entries.push(...page)
    } catch (error) {
      failed.push(SELF_INDEX_URL)
      console.warn('[plugbox] checkUpdates: self index failed:', SELF_INDEX_URL, describe(error))
    }
  }
  return { entries, failed }
}

/**
 * 把检查得到的索引条目同步回市场列表（只替换同名条目，不新增、不动搜索态），
 * 免得随后任何一次 loadStore 又拿旧数据把刚打上的「可更新」标记抹掉。
 */
function mergeUpdateSnapshot(entries: MarketEntry[]): void {
  const fresh = new Map(entries.map((entry) => [entry.name, entry]))
  state.market = state.market.map((entry) => fresh.get(entry.name) ?? entry)
}

/** 安装来源里的 #ref：精确取分支名，避免 main 命中 main-2 */
function installedRefOf(source: string | undefined): string {
  const at = (source ?? '').lastIndexOf('#')
  return at === -1 ? '' : (source ?? '').slice(at + 1)
}

/**
 * 分支不登记进索引、也没有发布版本，检查更新必须单独读一次仓库。
 * 判定依据是持久化基线（安装时与上次检查时记录的分支快照，跨会话有效）：
 * 所装分支被推了新提交、基线之后新出现的分支、任一分支版本更高，都算更新。
 * - 首次见到仓库（无基线，多为本功能之前装的）：只报版本抬升，其余诚实不报，
 *   本次建立基线；
 * - 零变更的仓库推进基线（变更窗口滚动）；有变更的保留旧基线——用户没处理的
 *   提醒不会在下次检查里凭空消失，直到通过面板安装或更新（基线随安装刷新）；
 * - 单个仓库读失败只跳过它，保留旧基线，不影响版本检查的结果。
 */
async function detectBranchUpdates(snapshot: MarketEntry[]): Promise<BranchUpdate[]> {
  const byName = new Map(snapshot.map((entry) => [entry.name, entry]))
  const candidates = state.bundles.filter(
    (bundle) => bundle.installed && bundle.availability !== 'missing' && bundle.version !== undefined,
  )
  const groups = await Promise.all(
    candidates.map(async (bundle): Promise<BranchUpdate[]> => {
      const entry = byName.get(bundle.name)
      const repo = githubRepoOf(entry?.repository, entry?.homepage, bundle.source)
      if (repo === null) return []
      const baseline = getRepoBaseline(repo)
      let branches: RepoBranch[]
      try {
        branches = await service.listRepoBranches(repo)
      } catch (error) {
        console.warn('[plugbox] checkUpdates: branches failed:', repo, describe(error))
        return []
      }
      const findings = diffBranches({
        baseline: baseline === null ? null : { names: baseline.names, heads: baseline.heads },
        branches,
        installedRef: installedRefOf(bundle.source),
        installedVersion: bundle.version,
      })
      if (baseline === null || findings.length === 0) {
        putRepoBaseline(repo, baselineFromScan(branches), 'check')
      }
      return findings.map((finding) => ({
        name: bundle.name,
        title: bundle.title,
        repo,
        branch: finding.branch,
        version: finding.version,
        newer: finding.newer,
        reason: finding.reason,
        spec: `git+https://github.com/${repo}#${finding.branch}`,
      }))
    }),
  )
  return groups.flat()
}

/**
 * 安装 / 更新成功后刷新该仓库的分支基线：用户刚通过面板处理过，旧提醒到此为止，
 * 之后上游的变化从这里重新算起。读失败就保留旧基线——宁可下次继续提醒，
 * 也不悄悄挪动对比锚点。
 */
async function recordInstallBaseline(bundleName: string): Promise<void> {
  const bundle = state.bundles.find((item) => item.name === bundleName)
  const entry = state.market.find((item) => item.name === bundleName)
  const repo = githubRepoOf(entry?.repository, entry?.homepage, bundle?.source)
  if (repo === null) return
  try {
    const branches = await service.listRepoBranches(repo)
    putRepoBaseline(repo, baselineFromScan(branches), 'install')
  } catch (error) {
    console.warn('[plugbox] install baseline failed:', repo, describe(error))
  }
}

async function checkUpdates(): Promise<void> {
  await withBusy('checkUpdates', async () => {
    state.checkingUpdates = true
    try {
      // 本地版本是比对基准：装完插件或切过分支后必须刷新，拿旧版本比会漏报
      await loadLocal()
      if (state.localStatus === 'error') {
        toast('warning', '读取已安装插件失败，检查结果可能不完整')
      }
      const { entries, failed } = await readMarketForUpdateCheck()
      // 快照不全时不许据此抹掉已有的更新标记（原来索引一失败就把标记全清空）
      applyUpdateFlags(entries, { complete: failed.length === 0 })
      mergeUpdateSnapshot(entries)
      const branches = await detectBranchUpdates(entries)
      // 索引读失败时快照不全，分支结果可能少了条目：和版本标记一样保留上一次的提醒，
      // 不能因为一次失败就把已经发现的分支变更清空
      if (failed.length === 0) state.branchUpdates = branches

      const versionCount = state.bundles.filter(isUpdatable).length
      const branchCount = state.branchUpdates.length
      const blocked = state.blockedUpdateCount
      const actionable = versionCount + branchCount
      if (actionable + blocked > 0) state.updateNoticeDismissed = false
      if (failed.length > 0) {
        toast('warning', `${failed.length} 个索引源读取失败，检查结果可能不完整`)
      }
      if (blocked > 0) {
        toast(
          'warning',
          `${blocked} 个插件有新版，但与当前${HOST.displayName}版本不兼容，暂不能一键更新`,
        )
      }
      toast(
        actionable > 0 ? 'success' : 'info',
        actionable > 0
          ? `发现 ${versionCount} 个版本更新${branchCount > 0 ? `、${branchCount} 项分支变更` : ''}`
          : blocked > 0
            ? `发现 ${blocked} 个新版，但受兼容限制暂不能更新`
            : failed.length > 0
              ? '暂时无法确认是否有更新'
              : '已是最新版本，暂无可用更新',
      )
    } catch (error) {
      // 取数失败不能伪装成「已是最新」，用户会以为真的检查过了
      toast('error', `检查更新失败：${describe(error)}`)
    } finally {
      state.checkingUpdates = false
    }
  })
}

async function updateOne(name: string): Promise<void> {
  await withBusy(`update:${name}`, async () => {
    const bundle = state.bundles.find((item) => item.name === name)
    if (!bundle?.updateSpec) return
    try {
      const result = await service.installBundle(bundle.updateSpec)
      const failure = resultMessage(result)
      if (failure) {
        toast('error', `更新失败：${failure}`)
        return
      }
      toast(
        result.application === 'restart-required' ? 'warning' : 'success',
        result.application === 'restart-required'
          ? `已更新 ${bundle.title}，重启宿主后生效`
          : `已将 ${bundle.title} 更新到 v${bundle.latestVersion}`,
      )
      await loadLocal()
      await loadStore()
      await recordInstallBaseline(name)
    } catch (error) {
      toast('error', `更新失败：${describe(error)}`)
    }
  })
}

async function updateAll(): Promise<void> {
  await withBusy('updateAll', async () => {
    state.updatingAll = true
    try {
      const targets = state.bundles.filter(
        (bundle): bundle is InstalledBundle & { updateSpec: string } =>
          bundle.updateSpec !== undefined && bundle.availability !== 'missing',
      )
      let success = 0
      let restart = false
      for (const bundle of targets) {
        try {
          const result = await service.installBundle(bundle.updateSpec)
          if (resultMessage(result) === null) {
            success += 1
            restart = restart || result.application === 'restart-required'
          }
        } catch {
          // 单个失败不阻断其余更新，结束时统一反馈
        }
      }
      const suffix = restart ? '，部分改动重启后生效' : ''
      if (success === targets.length) toast('success', `已更新 ${success} 个插件${suffix}`)
      else toast('warning', `已更新 ${success} 个，${targets.length - success} 个失败${suffix}`)
      await loadLocal()
      await loadStore()
      for (const target of targets) await recordInstallBaseline(target.name)
    } finally {
      state.updatingAll = false
    }
  })
}

// ============ 启用 / 停用 / 删除 ============

async function setEnabled(name: string, enabled: boolean): Promise<void> {
  await withBusy(`toggle:${name}`, async () => {
    const bundle = state.bundles.find((item) => item.name === name)
    try {
      const result = await service.setBundleEnabled(name, enabled)
      const failure = resultMessage(result)
      if (failure) {
        toast('error', `${enabled ? '启用' : '停用'}失败：${failure}`)
        return
      }
      const restart = result.application === 'restart-required'
      toast(
        restart ? 'warning' : 'success',
        `已${enabled ? '启用' : '停用'} ${bundle?.title ?? name}${restart ? '重启宿主后生效' : ''}`,
      )
      await loadLocal()
      await loadStore()
    } catch (error) {
      toast('error', `${enabled ? '启用' : '停用'}失败：${describe(error)}`)
    }
  })
}

async function removeByName(name: string): Promise<void> {
  const bundle = state.bundles.find((item) => item.name === name)
  if (!bundle) return
  const ok = await openConfirm({
    title: '卸载组合包',
    message: `确定要卸载「${bundle.title}」吗？依赖会被移除，profile 里的插件行随之消失，此操作不可撤销。`,
    confirmText: '卸载',
    danger: true,
  })
  if (!ok) return
  await withBusy(`remove:${name}`, async () => {
    try {
      const result = await service.removeBundle(name)
      const failure = resultMessage(result)
      if (failure) {
        toast('error', `卸载失败：${failure}`)
        return
      }
      toast(
        result.application === 'restart-required' ? 'warning' : 'success',
        `已卸载 ${bundle.title}${result.application === 'restart-required' ? '重启宿主后生效' : ''}`,
      )
      if (state.detailName === name) closeDetail()
      await loadLocal()
      await loadStore()
    } catch (error) {
      toast('error', `卸载失败：${describe(error)}`)
    }
  })
}

// ============ 安装 ============

async function installEntry(entry: MarketEntry): Promise<void> {
  await withBusy(`install:${entry.name}`, async () => {
    const version = entry.defaultVersion
    const target = entry.versions.find((item) => item.version === version)
    if (!target) {
      toast('warning', '这个插件没有可安装的版本')
      return
    }
    // 宿主的安装前检查会按真实 package.json 拒绝不兼容版本并回滚，这里先拦一次，省掉一轮安装卸载
    if (target.compatible === false) {
      // 键可能有命名空间（适配器加的前缀），也可能就是宿主原始字段名，两个都要认
      const range = hostRequirementOf(HOST, target.requirements, 'engines.dsh')
      toast(
        'warning',
        range
          ? `${entry.title} v${version} 要求${HOST.displayName} ${range}，当前环境不满足，装不进去`
          : `${entry.title} v${version} 与当前${HOST.displayName}版本不兼容，装不进去`,
      )
      return
    }
    try {
      const result = await service.installBundle(target.spec, { registry: target.registry ?? null })
      const failure = resultMessage(result)
      if (failure) {
        toast('error', `安装失败：${failure}`)
        return
      }
      toast(
        result.application === 'restart-required' ? 'warning' : 'success',
        `已安装 ${entry.title} v${version}${result.application === 'restart-required' ? '重启宿主后生效' : ''}`,
      )
      await loadLocal()
      await loadStore()
      await recordInstallBaseline(entry.name)
    } catch (error) {
      toast('error', `安装失败：${describe(error)}`)
    }
  })
}

async function installSpec(spec: string): Promise<boolean> {
  const trimmed = spec.trim()
  if (!trimmed) {
    toast('warning', '请输入包名、git 地址或本地目录')
    return false
  }
  const done = await withBusy('installSpec', async () => {
    try {
      const result = await service.installBundle(trimmed)
      const failure = resultMessage(result)
      if (failure) {
        toast('error', `安装失败：${failure}`)
        return false
      }
      toast(
        result.application === 'restart-required' ? 'warning' : 'success',
        `已安装 ${result.target}${result.application === 'restart-required' ? '重启宿主后生效' : ''}`,
      )
      state.installOpen = false
      await loadLocal()
      await loadStore()
      await recordInstallBaseline(result.target)
      return true
    } catch (error) {
      toast('error', `安装失败：${describe(error)}`)
      return false
    }
  })
  return done === true
}

// ============ 按分支安装 ============

/**
 * 分支是上游的活口：卡片左下角的版本号点开就是分支列表，装在卡片内联完成。
 * 装的是该分支当前的头提交——上游后续推送会改变它，所以不假装它是固定版本。
 */
async function installBranchAt(
  entry: MarketEntry,
  repo: string,
  branch: RepoBranch,
): Promise<boolean> {
  if (!branch.bundle) {
    toast('warning', `${branch.name} 分支没有声明组合包，装进来也不能按插件管理`)
    return false
  }
  const done = await withBusy(`branch-install:${repo}#${branch.name}`, async () => {
    const spec = `git+https://github.com/${repo}#${branch.name}`
    try {
      const result = await service.installBundle(spec)
      const failure = resultMessage(result)
      if (failure) {
        toast('error', `安装失败：${failure}`)
        return false
      }
      const version = branch.version ? ` v${branch.version}` : ''
      const restart = result.application === 'restart-required'
      toast(
        restart ? 'warning' : 'success',
        `已安装 ${entry.title}${version}（${branch.name} 分支）${restart ? '重启宿主后生效' : ''}`,
      )
      await loadLocal()
      await loadStore()
      await recordInstallBaseline(entry.name)
      return true
    } catch (error) {
      toast('error', `安装失败：${describe(error)}`)
      return false
    }
  })
  return done === true
}

/** 读分支列表：失败原因在这里翻成中文，卡片只负责展示 */
async function loadRepoBranches(
  repo: string,
): Promise<{ ok: boolean; branches: RepoBranch[]; error?: string }> {
  try {
    return { ok: true, branches: await service.listRepoBranches(repo) }
  } catch (error) {
    return { ok: false, branches: [], error: describe(error) }
  }
}

// ============ 详情页 ============

function openDetail(name: string): void {
  state.detailName = name
  state.view = 'detail'
}

function closeDetail(): void {
  state.view = 'list'
  state.detailName = null
}

async function setRowEnabled(entryId: string, enabled: boolean): Promise<void> {
  await withBusy(`row:${entryId}`, async () => {
    try {
      const result = await service.setPluginEnabled(entryId, enabled)
      const failure = resultMessage(result)
      if (failure) {
        toast('error', `${enabled ? '启用' : '停用'}失败：${failure}`)
        return
      }
      toast('success', `已${enabled ? '启用' : '停用'}该插件行`)
      await loadLocal()
    } catch (error) {
      toast('error', `${enabled ? '启用' : '停用'}失败：${describe(error)}`)
    }
  })
}

// ============ 派生数据 ============

const byTitle = (a: { title: string }, b: { title: string }) =>
  a.title.localeCompare(b.title, 'zh-Hans-CN')

const ORIGIN_RANK: Record<BundleOrigin, number> = { official: 0, 'third-party': 1, local: 2 }

const INSTALL_RANK: Record<MarketEntry['installation']['status'], number> = {
  'not-installed': 0,
  'update-available': 1,
  'different-version': 2,
  installed: 3,
  provided: 4,
}

/** 管理 Tab 的基表：当前 profile 里已安装或随宿主附带的组合包 */
const localBase = computed(() =>
  state.bundles.filter((bundle) => bundle.installed || bundle.availability === 'installation'),
)

/** 来源统计只看基表，不随搜索与筛选变化，数字才不会跳 */
const localStats = computed(() => {
  const counts: Record<LocalFilter, number> = {
    all: localBase.value.length,
    official: 0,
    'third-party': 0,
    local: 0,
  }
  for (const bundle of localBase.value) counts[bundleOrigin(bundle)] += 1
  return counts
})

const storeStats = computed(() => {
  const counts: Record<StoreFilter, number> = {
    all: state.market.length,
    official: 0,
    catalog: 0,
    'third-party': 0,
    installed: 0,
    available: 0,
  }
  for (const entry of state.market) {
    counts[entry.label] += 1
    counts[entry.installation.status === 'not-installed' ? 'available' : 'installed'] += 1
  }
  return counts
})


const STORE_FILTER_TEXT: Record<StoreFilter, string> = {
  all: '全部',
  official: HOST.labels.vendor,
  catalog: HOST.labels.curated,
  'third-party': '第三方来源',
  installed: '已安装',
  available: '可安装',
}

/** 这三种是「来源」筛选：它们为 0 属于异常，其余为 0（比如还没装任何插件）是常态 */
const SOURCE_FILTERS: ReadonlySet<StoreFilter> = new Set<StoreFilter>([
  'official',
  'catalog',
  'third-party',
])

type StoreConditionKind = 'query' | 'filter' | 'authors' | 'categories'

interface StoreCondition {
  kind: StoreConditionKind
  text: string
  /** 来源一档空了但索引里还有别的插件：多半是提供它的索引源被移除，要显眼地自证 */
  warn?: boolean
}

/**
 * 生效中的筛选条件摘要：由 state 直接算出，不依赖分面 chip 是否还在。
 * chip 会随分面重算而消失（作者被筛掉后就不在列表里了），条件本身不能跟着消失，
 * 否则列表空得没来由，用户连「取消哪一项」都找不到入口。
 */
const storeConditions = computed<StoreCondition[]>(() => {
  const conditions: StoreCondition[] = []
  const keyword = state.storeQuery.trim()
  if (keyword) conditions.push({ kind: 'query', text: `关键词 "${keyword}"` })
  if (state.storeFilter !== 'all') {
    const label = STORE_FILTER_TEXT[state.storeFilter]
    const count = storeStats.value[state.storeFilter]
    // 「已安装 0 条」是正常的，不该报警；来源那一档独独空了才是异常
    const orphaned = count === 0 && SOURCE_FILTERS.has(state.storeFilter) && state.market.length > 0
    conditions.push({
      kind: 'filter',
      text: orphaned ? `来源 ${label}（0 条，提供它的索引源可能已移除）` : `来源 ${label}`,
      warn: orphaned,
    })
  }
  if (state.storeAuthors.length === 1) {
    conditions.push({ kind: 'authors', text: `创作者 ${state.storeAuthors[0]}` })
  } else if (state.storeAuthors.length > 1) {
    conditions.push({ kind: 'authors', text: `创作者 ${state.storeAuthors.length} 位` })
  }
  if (state.storeCategories.length > 0) {
    const labels = state.storeCategories.map((key) => MARKET_CATEGORY_LABEL[key] ?? key)
    conditions.push({ kind: 'categories', text: `分类 ${labels.join('/')}` })
  }
  return conditions
})

/** 摘掉某一个条件，其余筛选保留 */
function clearStoreCondition(kind: StoreConditionKind): void {
  switch (kind) {
    case 'query':
      clearStoreQuery()
      return
    case 'filter':
      state.storeFilter = 'all'
      return
    case 'authors':
      state.storeAuthors = []
      return
    default:
      state.storeCategories = []
  }
}

function matchesLocalQuery(bundle: InstalledBundle, q: string): boolean {
  if (!q) return true
  return [bundle.title, bundle.name, bundle.description]
    .concat(bundle.rows.map((row) => `${row.title} ${row.moduleName}`))
    .some((text) => text.toLowerCase().includes(q))
}

const filteredLocal = computed(() => {
  const q = state.localQuery.trim().toLowerCase()
  const list = localBase.value.filter(
    (bundle) =>
      (state.localFilter === 'all' || bundleOrigin(bundle) === state.localFilter) &&
      matchesLocalQuery(bundle, q),
  )
  const sorters: Record<LocalSortKey, (a: InstalledBundle, b: InstalledBundle) => number> = {
    status: (a, b) => Number(b.enabled) - Number(a.enabled) || byTitle(a, b),
    name: byTitle,
    package: (a, b) => a.name.localeCompare(b.name),
    origin: (a, b) => ORIGIN_RANK[bundleOrigin(a)] - ORIGIN_RANK[bundleOrigin(b)] || byTitle(a, b),
  }
  return list.sort(sorters[state.localSort])
})

function matchesStoreFilter(entry: MarketEntry): boolean {
  switch (state.storeFilter) {
    case 'official':
    case 'catalog':
    case 'third-party':
      return entry.label === state.storeFilter
    case 'available':
      return entry.installation.status === 'not-installed'
    case 'installed':
      return entry.installation.status !== 'not-installed'
    default:
      return true
  }
}

/** 索引声明的总条数（各索引源的 total 之和） */
const indexDeclaredTotal = computed(() =>
  Object.values(state.indexTotals).reduce((sum, n) => sum + n, 0),
)

/** 索引声明的总条数与已加载条数不一致时（翻页上限），如实告诉用户列表不全 */
const storeTruncated = computed(() => {
  // 加载中对比的是上一轮的数字，换个筛选还会闪一下，只在稳定态提示
  if (state.storeStatus !== 'ready') return 0
  const declared = indexDeclaredTotal.value
  return declared > state.market.length ? declared : 0
})

/** 索引条目没有 author 时归入这一档，保证创作者分面的计数加起来等于当前结果数 */
const UNKNOWN_AUTHOR = '未标注作者'

const authorOf = (entry: MarketEntry): string => entry.author?.trim() || UNKNOWN_AUTHOR

/**
 * 创作者分面：只按来源筛选统计，因此选中某个创作者后其他档的计数不会塌成 0。
 * 每条索引条目只有一个 author，所以多选是「任一命中」，不做「同时属于多人」的交集。
 */
const AUTHOR_FACET_LIMIT = 8
const AUTHOR_FACET_EXPANDED = 24
/** 作者数超过这个量级时，chip 已经没有筛选价值，改用搜索 */
const AUTHOR_FACET_OVERFLOW = 200

const authorFacetAll = computed(() => {
  const counts = new Map<string, number>()
  for (const entry of state.market) {
    if (!matchesStoreFilter(entry)) continue
    const author = authorOf(entry)
    counts.set(author, (counts.get(author) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([author, count]) => ({ author, count }))
    .sort((a, b) => b.count - a.count || a.author.localeCompare(b.author, 'zh-Hans-CN'))
})

const authorFacetTotal = computed(() => authorFacetAll.value.length)
const authorFacetOverflow = computed(() => authorFacetTotal.value > AUTHOR_FACET_OVERFLOW)

/** 几千条社区条目会带来上千位作者，分面只展示头部，其余交给搜索 */
const authorFacets = computed(() =>
  authorFacetAll.value.slice(
    0,
    state.authorFacetsExpanded ? AUTHOR_FACET_EXPANDED : AUTHOR_FACET_LIMIT,
  ),
)

const authorFacetsHidden = computed(() =>
  Math.max(0, authorFacetAll.value.length - authorFacets.value.length),
)

function toggleAuthorFacets(): void {
  state.authorFacetsExpanded = !state.authorFacetsExpanded
}

/** 分类分面：计数只受来源与作者影响，选中分类后其他档不塌陷 */
const categoryFacets = computed(() => {
  const counts = new Map<string, number>()
  for (const entry of state.market) {
    if (!matchesStoreFilter(entry) || !matchesStoreAuthor(entry)) continue
    const key = entry.category ?? ''
    if (key === '') continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
})

function matchesStoreCategory(entry: MarketEntry): boolean {
  return (
    state.storeCategories.length === 0 ||
    state.storeCategories.includes(entry.category ?? '')
  )
}

function setStoreCategory(category: string): void {
  const index = state.storeCategories.indexOf(category)
  if (index >= 0) state.storeCategories.splice(index, 1)
  else state.storeCategories.push(category)
}

function matchesStoreAuthor(entry: MarketEntry): boolean {
  return state.storeAuthors.length === 0 || state.storeAuthors.includes(authorOf(entry))
}

function setStoreAuthor(author: string): void {
  const index = state.storeAuthors.indexOf(author)
  if (index >= 0) state.storeAuthors.splice(index, 1)
  else state.storeAuthors.push(author)
}

const storeGroups = computed(() => {
  const groups = new Map<string, { title: string; url: string; entries: MarketEntry[] }>()
  for (const entry of state.market) {
    if (!matchesStoreFilter(entry) || !matchesStoreAuthor(entry) || !matchesStoreCategory(entry))
      continue
    const group = groups.get(entry.indexUrl) ?? {
      title: entry.indexTitle,
      url: entry.indexUrl,
      entries: [],
    }
    group.entries.push(entry)
    groups.set(entry.indexUrl, group)
  }
  const sorters: Partial<Record<StoreSortKey, (a: MarketEntry, b: MarketEntry) => number>> = {
    name: byTitle,
    author: (a, b) => (a.author ?? '').localeCompare(b.author ?? '') || byTitle(a, b),
    installable: (a, b) =>
      INSTALL_RANK[a.installation.status] - INSTALL_RANK[b.installation.status] || byTitle(a, b),
  }
  const sorter = sorters[state.storeSort]
  // 分组顺序跟随订阅顺序（listIndexes 返回的顺序），精选索引提到最前：
  // 社区目录有 5,413 条，按条数降序会把它挤到用户看不见的位置
  const order = new Map(state.indexes.map((index, position) => [index.url, position]))
  const result = [...groups.values()].sort((a, b) => {
    const featured = Number(isPinnedIndex(b.url)) - Number(isPinnedIndex(a.url))
    if (featured !== 0) return featured
    return (
      (order.get(a.url) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.url) ?? Number.MAX_SAFE_INTEGER)
    )
  })
  if (sorter) for (const group of result) group.entries.sort(sorter)
  return result
})

const visibleStoreCount = computed(() =>
  storeGroups.value.reduce((sum, group) => sum + group.entries.length, 0),
)

/** 按预算切片渲染，避免一次把几千张卡片塞进 DOM；搜索或筛选变化时重置 */
const renderedStoreGroups = computed(() => {
  let budget = state.storeRenderLimit
  const groups: Array<{ title: string; url: string; entries: MarketEntry[]; total: number }> = []
  for (const [position, group] of storeGroups.value.entries()) {
    if (groups.length > 0 && budget <= 0) break
    // 预算先给第一个分组足额（精选组完整渲染），剩下的按顺序分给后续分组
    const full = position === 0 && isPinnedIndex(group.url)
    const entries = full ? group.entries : group.entries.slice(0, Math.max(budget, 0))
    if (entries.length === 0) break
    budget -= entries.length
    groups.push({ ...group, entries, total: group.entries.length })
  }
  return groups
})

/** 条目多到一定程度后换用更密的卡片网格：1216 宽下两列 599px 的卡太浪费 */
const STORE_DENSE_THRESHOLD = 500

const denseStoreCards = computed(() => visibleStoreCount.value > STORE_DENSE_THRESHOLD)

const storeHasMore = computed(() => visibleStoreCount.value > state.storeRenderLimit)

function showMoreStore(): void {
  state.storeRenderLimit += 120
}

function resetStoreRenderLimit(): void {
  state.storeRenderLimit = 120
}

/** 统计卡与 chips 共用：再次点击已选中的分类回到全部 */
function setLocalFilter(value: LocalFilter): void {
  state.localFilter = state.localFilter === value && value !== 'all' ? 'all' : value
}

function setStoreFilter(value: StoreFilter): void {
  state.storeFilter = state.storeFilter === value && value !== 'all' ? 'all' : value
}

function isUpdatable(bundle: InstalledBundle): boolean {
  return bundle.updateSpec !== undefined && bundle.latestVersion !== undefined
}

const updateCount = computed(() => state.bundles.filter(isUpdatable).length)

const branchUpdateCount = computed(() => state.branchUpdates.length)

const branchUpdatesOf = (name: string): BranchUpdate[] =>
  state.branchUpdates.filter((item) => item.name === name)

const detailBundle = computed(
  () => (state.view === 'detail' && state.detailName
    ? state.bundles.find((bundle) => bundle.name === state.detailName) ?? null
    : null),
)

const hasIndexes = computed(() => state.indexes.length > 0)

const installedVersionOf = (name: string): string | undefined =>
  state.bundles.find((bundle) => bundle.name === name)?.version

function switchTab(tab: TabKey): void {
  // 离开市场页时只掐定时器：用户已经不看这个 tab 了，没必要再发一轮搜索；
  // 但也不能把在途的加载作废——那会让列表在他回来时停在「还没加载完」
  if (state.activeTab === 'store' && tab !== 'store') clearStoreSearchTimers()
  state.activeTab = tab
}

function gotoStore(): void {
  state.storeQuery = ''
  state.storeFilter = 'all'
  state.storeAuthors = []
  state.storeCategories = []
  state.activeTab = 'store'
  // 已经在加载中就别再发一轮：bumped token 之后补发的那轮用的已经是清干净的筛选
  if (!cancelStoreSearch()) void loadStore()
}

/** 从更新提示条跳到市场并定位到有分支变更的插件，用户才能点版本号选分支 */
function gotoBranchUpdates(): void {
  const first = state.branchUpdates[0]
  if (first === undefined) {
    gotoStore()
    return
  }
  state.storeQuery = first.name
  state.storeFilter = 'all'
  state.storeAuthors = []
  state.storeCategories = []
  state.activeTab = 'store'
  void loadStoreSearch()
}

/**
 * 开发指南改成面板内的弹窗：README 与宿主契约随本包构建进产物，
 * 不再把用户丢到某个第三方 GitHub 主页，离线也能读。
 */
function openDevGuide(): void {
  state.devGuideOpen = true
}

function closeDevGuide(): void {
  state.devGuideOpen = false
}

function openInstallDialog(): void {
  state.installOpen = true
}

function closeInstallDialog(): void {
  state.installOpen = false
}

export const pluginCenter = {
  state,
  init,
  switchTab,
  gotoStore,
  gotoBranchUpdates,
  openDevGuide,
  closeDevGuide,

  loadLocal,
  loadStore,
  scheduleStoreSearch,
  loadStoreSearch,
  cancelStoreSearch,
  clearStoreQuery,
  clearStoreCondition,
  subscribeSelfIndex,
  subscribeCommunityIndex,

  checkUpdates,
  updateOne,
  updateAll,
  dismissUpdateNotice,
  setEnabled,
  removeByName,

  installEntry,
  installSpec,
  openInstallDialog,
  closeInstallDialog,

  installBranchAt,
  loadRepoBranches,

  openDetail,
  closeDetail,
  setRowEnabled,

  toast,
  dismissToast,
  resolveConfirm,

  isUpdatable,
  installedVersionOf,
  hasIndexes,

  filteredLocal,
  storeGroups,
  renderedStoreGroups,
  storeHasMore,
  showMoreStore,
  updateCount,
  branchUpdateCount,
  branchUpdatesOf,
  detailBundle,

  localBase,
  localStats,
  storeStats,
  storeConditions,
  indexDeclaredTotal,
  storeTruncated,
  authorFacets,
  authorFacetsHidden,
  authorFacetTotal,
  authorFacetOverflow,
  toggleAuthorFacets,
  setStoreAuthor,
  categoryFacets,
  setStoreCategory,
  visibleStoreCount,
  denseStoreCards,
  setLocalFilter,
  setStoreFilter,
}

export type PluginCenterStore = typeof pluginCenter
