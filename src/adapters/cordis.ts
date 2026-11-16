/**
 * Cordis 协议族适配器的共用实现。
 *
 * DeepSeek Harness 与 zcode 版 Harness 跑在同一套 Cordis 宿主运行时上：
 * 同样的 patch 机制、同样的 webServer.register({ kind: 'prefix' })、
 * 同样的 __ModuleLoader__ 注册、同样的 pluginManager / pluginMarket 服务。
 * 差异只在「挂载前缀 / 面板 id / 展示名 / 是否已实测」这些描述性信息上。
 *
 * 所以这里做一个工厂，把真正的差异做成一份 descriptor：
 * 新增一个同族宿主 = 写一份 descriptor，不用碰任何协议实现。
 * 将来遇到协议真的不同的宿主（比如纯 CLI 型），不要往这里塞，
 * 另写一个不受此工厂约束的 HostAdapter 实现。
 */

import { BRAND } from '../core/protocol/brand'
import type { CanonicalPlugin } from '../core/protocol/plugin'
import type {
  HostAdapter,
  HostAdapterId,
  LabelBinding,
  ManifestView,
  RawManifest,
  ResourceBinding,
  UiBinding,
} from './types'

export interface CordisDescriptor {
  id: HostAdapterId
  displayName: string
  /** 挂静态产物的前缀；同族不同宿主不能撞 */
  routePrefix: string
  /** 面板 id，也是宿主 patch 里的实体 id */
  panelId: string
  /** __ModuleLoader__ 注册的模块 id */
  moduleId: string
  /** locale 命名空间 */
  localeNamespace: string
  /** 效果注册 key 前缀，避免和同一个宿主里的其他插件撞名 */
  effectKeyPrefix: string
  /** 索引里表示「宿主官方」的 labels 值；不同发行版可能不一样 */
  vendorLabels: string[]
  /** 哪些 npm scope 算本宿主自带 */
  vendorScopes: string[]
  /** 装在哪个 profile / 产品线里，主要给文档与安装提示用 */
  profileHint: string
  verified: boolean
  openQuestions?: string[]
}

function uiOf(d: CordisDescriptor): UiBinding {
  return {
    routePrefix: d.routePrefix,
    rpcPath: `${d.routePrefix}/api/rpc`,
    moduleId: d.moduleId,
    panelId: d.panelId,
    localeNamespace: d.localeNamespace,
    // Cordis 系宿主已验证可用的两个槽位：侧栏入口 + 主面板
    slots: ['sidebar.panellist', 'main'],
    effectKeyPrefix: d.effectKeyPrefix,
  }
}

function labelsOf(d: CordisDescriptor): LabelBinding {
  return {
    vendor: `${d.displayName} 官方`,
    curated: `${BRAND.name} 收录`,
    thirdParty: '第三方',
  }
}

/**
 * Cordis 系的 UI 资源槽位：
 * `sidebar.panellist` 是侧栏入口，`main` 是主面板，其余槽位尚未验证，一律不认领。
 */
const SLOTS = new Set(['sidebar.panellist', 'main'])

function resourcesOf(): ResourceBinding {
  return {
    map(resource) {
      if (resource.kind === 'ui-slot') {
        const slot = (resource.payload as { slot?: string } | undefined)?.slot
        if (slot === undefined || !SLOTS.has(slot)) return null
        return { adapter: 'cordis', kind: resource.kind, id: resource.id, placement: slot, payload: resource.payload }
      }
      if (resource.kind === 'transport') {
        return {
          adapter: 'cordis',
          kind: resource.kind,
          id: resource.id,
          placement: 'webServer.prefix',
          payload: resource.payload,
        }
      }
      // 命令 / 工具 / 模型这类资源在 Cordis 系里由插件自己的 bundle 声明，
      // PlugBox 不接管它们的装配，如实返回 null 让上层降级。
      return null
    },
  }
}

function repositoryOf(raw: RawManifest): string | undefined {
  if (typeof raw.repository === 'string') return raw.repository
  return raw.repository?.url
}

export function createCordisAdapter(d: CordisDescriptor): HostAdapter {
  return {
    id: d.id,
    displayName: d.displayName,
    family: 'cordis',
    verified: d.verified,
    openQuestions: d.openQuestions,
    ui: uiOf(d),
    labels: labelsOf(d),
    catalog: {
      indexFormat: 'cordis-market-index@1',
      policy: {
        vendorLabels: d.vendorLabels,
        curatedKeywords: [BRAND.catalogMarker],
      },
      marker: BRAND.catalogMarker,
    },
    manifest: {
      extract(raw) {
        const dsh = (raw.dsh ?? {}) as {
          bundle?: { patch?: string }
          client?: Record<string, unknown>
          meta?: { title?: unknown; description?: unknown }
        }
        const engines = (raw.engines ?? {}) as Record<string, unknown>
        const meta = dsh.meta ?? {}
        const view: ManifestView = {
          id: raw.name ?? '',
          version: raw.version,
          title: firstText(meta.title) ?? raw.name,
          description: firstText(meta.description) ?? raw.description,
          license: raw.license,
          keywords: Array.isArray(raw.keywords) ? raw.keywords : [],
          homepage: raw.homepage,
          repository: repositoryOf(raw),
          requirements: typeof engines.dsh === 'string' ? { 'engines.dsh': engines.dsh } : {},
          hostFields: {
            bundle: dsh.bundle,
            client: dsh.client,
            meta: dsh.meta,
          },
        }
        return view
      },
      compose(view) {
        const out: Record<string, unknown> = {
          name: view.id,
          version: view.version,
          description: view.description,
          license: view.license,
          keywords: view.keywords,
          homepage: view.homepage,
        }
        if (view.repository !== undefined) out.repository = view.repository
        const dshRange = view.requirements['engines.dsh']
        // engines.dsh 留空对象等于向宿主宣称「任意版本都能装」，那是不负责任的声明，所以没有范围就不写
        if (dshRange !== undefined && dshRange !== '') out.engines = { dsh: dshRange }
        if (Object.keys(view.hostFields).length > 0) out.dsh = view.hostFields
        return out
      },
      requirementKeyOf(field) {
        return `${d.id}/${field}`
      },
      pluginGate(view) {
        const bundle = view.hostFields.bundle as unknown
        return bundle !== undefined && bundle !== null
      },
      // 不打 satisfies：DSH 的判定必须带 includePrerelease，且宿主早已把结论
      // 放进 compatible 字段里。核心再实现一遍只会得到两套打架的结论。
    },
    resources: resourcesOf(),
    methods: {
      status: 'status',
      listBundles: 'listBundles',
      listPlugins: 'listPlugins',
      setBundleEnabled: 'setBundleEnabled',
      setPluginEnabled: 'setPluginEnabled',
      removeBundle: 'removeBundle',
      installBundle: 'installBundle',
      listIndexes: 'listIndexes',
      setIndexes: 'setIndexes',
      searchMarket: 'searchMarket',
      repoBranches: 'repoBranches',
    },
    vendorPackageScopes: d.vendorScopes,
    gitSource: {
      parse(source) {
        const spec = source ?? ''
        const at = spec.lastIndexOf('#')
        if (at === -1) return { ref: '' }
        const [ref = '', ...params] = spec.slice(at + 1).split('&')
        const directory = params.find((param) => param.startsWith('path:'))?.slice(5).replace(/^\//, '')
        return { ref, ...(directory ? { directory } : {}) }
      },
      branchSpec(repo, branch, directory) {
        return `git+https://github.com/${repo}.git#${branch}${directory === undefined ? '' : `&path:/${directory}`}`
      },
    },
    installSpec(plugin: CanonicalPlugin, version?: string) {
      const target =
        version === undefined
          ? plugin.versions.find((item) => item.version === plugin.defaultVersion) ?? plugin.versions[0]
          : plugin.versions.find((item) => item.version === version)
      const source = target?.sources.find((item) => item.type === 'git') ?? target?.sources[0]
      if (source === undefined) return undefined
      return source.ref === undefined ? source.locator : `${source.locator}#${source.ref}`
    },
  }
}

function firstText(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  for (const key of ['zh', 'en']) {
    const item = record[key]
    if (typeof item === 'string') return item
  }
  return undefined
}
