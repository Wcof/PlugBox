/**
 * 适配层契约 —— PlugBox 的扩展点全在这里。
 *
 * 一句话：适配器回答「这个宿主怎么说话」，核心回答「插件是什么」。
 * 新增一个宿主 = 往 src/adapters/ 下加一个实现了 HostAdapter 的目录 + 在 registry 里登记，
 * 核心一行都不用改。反过来说，如果为了接一个新宿主改了 src/core/，那是设计出了问题。
 */

import type {
  CanonicalPlugin,
  PluginResource,
  ResourceKind,
  RequirementKey,
} from '../core/protocol/plugin'
import type { ProvenancePolicy } from '../core/protocol/catalog'

/**
 * 适配器 id。字面量便于代码提示，`(string & {})` 让第三方还能扩。
 * 命名建议用宿主的正式小写名，例如 'dsh'、'zcode-dsh'。
 */
export type HostAdapterId = 'dsh' | 'zcode-dsh' | (string & {})


/** 一行用户对道岔的操作：核心只认这些动词，不认任何宿主的 API 名 */
export type CanonicalMethod =
  | 'status'
  | 'listBundles'
  | 'listPlugins'
  | 'setBundleEnabled'
  | 'setPluginEnabled'
  | 'removeBundle'
  | 'installBundle'
  | 'listIndexes'
  | 'setIndexes'
  | 'searchMarket'
  | 'repoBranches'

/** 面板在宿主里的挂载形态 */
export interface UiBinding {
  /** Host 半边挂载静态产物的前缀，例如 '/plugbox' */
  routePrefix: string
  /** JSON-RPC 端点路径 */
  rpcPath: string
  /** 宿主 UI 注册用的模块 id */
  moduleId: string
  /** 侧栏面板 id */
  panelId: string
  /** locale 命名空间 */
  localeNamespace: string
  /** 需要占用的宿主槽位，例如 ['sidebar.panellist', 'main'] */
  slots: string[]
  /** 宿主副作用注册的 key 前缀，避免和别的插件撞名 */
  effectKeyPrefix: string
}

/** UI 上那枚来源标签的展示名：官方那一档写宿主自己的名字 */
export interface LabelBinding {
  vendor: string
  curated: string
  thirdParty: string
}

/** 索引侧的宿主差异 */
export interface CatalogBinding {
  /** 这个宿主的索引依赖哪种格式（用来挑 index adapter） */
  indexFormat: string
  /** 宿主索引里出现哪些标记算「官方」/「收录」 */
  policy: ProvenancePolicy
  /** 本产品在该宿主索引里使用的来源标记词 */
  marker: string
}

/** 清单双向转换：宿主原始 manifest ⇄ 中间视图 ⇄ canonical */
export interface ManifestBinding {
  /**
   * 从宿主 package.json 里读出该宿主关心的部分。
   * 返回的是「中间视图」而不是 canonical：宿主字段（如组合包声明）宿主专属，
   * 丢进 canonical 会把核心污染回去。
   */
  extract(raw: RawManifest): ManifestView
  /** 反过来：把中间视图写回宿主 package.json 应该有的形状 */
  compose(view: ManifestView): Record<string, unknown>
  /** 宿主字段名 → 带命名空间的兼容要求键，例如 'engines.dsh' → 'dsh/dsh' */
  requirementKeyOf(field: string): RequirementKey
  /**
   * 版本区间判定。语义库（semver 规则细节）是宿主生态的一部分：
   * DSH 用 semver.satisfies + includePrerelease，别的宿主未必一样，
   * 所以交给适配器实现；不实现时核心只返回 'unknown' 而不猜。
   */
  satisfies?(range: string, runtime: string): boolean
  /** 该宿主对「这算不算一个插件」的最低门槛；不实现即视为无法校验 */
  pluginGate?(view: ManifestView): boolean
}

/** 宿主 package.json 的最小公共形状：够读就行，不要替宿主做类型判断 */
export interface RawManifest {
  name?: string
  version?: string
  description?: string
  license?: string
  keywords?: string[]
  homepage?: string
  repository?: string | { url?: string }
  author?: unknown
  [key: string]: unknown
}

/** 中间视图：核心能懂的一半 + 宿主专属的一半 */
export interface ManifestView {
  id: string
  version?: string
  title?: string
  description?: string
  license?: string
  keywords: string[]
  homepage?: string
  repository?: string
  icon?: string
  requirements: Record<string, string>
  /** 宿主专属字段原样保留，例如 DSH 的 bundle patch 声明 */
  hostFields: Record<string, unknown>
}

/** 一条资源被映射到宿主里的哪个位置 */
export interface ResourceClaim {
  adapter: HostAdapterId
  kind: ResourceKind
  id: string
  /** 落到宿主上的目标位置/views槽位/安装参数名 */
  placement: string
  payload: unknown
}

export interface ResourceBinding {
  /** canonical 资源 → 宿主申领；返回 null 表示该宿主接不住这类资源 */
  map(resource: PluginResource): ResourceClaim | null
}

export interface HostAdapter {
  readonly id: HostAdapterId
  /** 展示名，用在「xxx 官方」这类文案里 */
  readonly displayName: string
  /** 协议族：同族的宿主可以复用UI/传输实现（例如都跑在 Cordis 上） */
  readonly family: 'cordis' | 'cli' | 'custom'
  /** 是否已在真实宿主上跑通过。false 的适配器不得作为默认选择 */
  readonly verified: boolean
  /** 待核实项：写了就不许声称已支持 */
  readonly openQuestions?: string[]
  readonly ui: UiBinding
  readonly labels: LabelBinding
  readonly catalog: CatalogBinding
  readonly manifest: ManifestBinding
  readonly resources: ResourceBinding
  /** IPC 动词映射上限：canonical 动词 → 宿主真实调用名 */
  readonly methods: Record<CanonicalMethod, string>
  /**
   * 哪些 npm scope 算「随宿主附带」。例如 Cordis 系宿主的官方包挂在 '@deepseek-ai/' 下，
   * 但宿主的 official 标记未必随之上，"判断哪些 scope 属于本宿主" 只能由它自己说。
   */
  readonly vendorPackageScopes: readonly string[]
  /** canonical 描述 → 宿主安装参数 */
  installSpec(plugin: CanonicalPlugin, version?: string): string | undefined
  /** 宿主 Git 安装来源的 ref / 包目录编码；UI 不自行拼接宿主参数。 */
  gitSource: {
    parse(source?: string): { ref: string; directory?: string }
    branchSpec(repo: string, branch: string, directory?: string): string
  }
}
