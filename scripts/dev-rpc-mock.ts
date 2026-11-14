/**
 * 仅开发服务器使用的 RPC 假数据（不进构建产物）。
 *
 * 生产环境里 /plugbox/api/rpc 由组合包 Host 半边接真实的 DSH 服务；
 * 但 npm run dev 时页面跑在 Vite 上，没有宿主，所以这里给一份形状一致的数据，
 * 让 UI 能在浏览器里改。数据刻意取自本机 profile 的真实组合包名。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

interface MockRow {
  rowId: string
  moduleName: string
  meta?: { title?: string; description?: string; icon?: string }
  entryId?: string
}

interface MockBundle {
  name: string
  official: boolean
  availability: 'profile' | 'installation' | 'missing'
  version?: string
  meta?: { title?: string; description?: string; icon?: string }
  description?: string
  enabled: boolean
  installed: boolean
  optional: boolean
  removable: boolean
  readOnlyReason?: 'management-required' | 'unaddressable'
  source?: string
  rows: MockRow[]
}

interface MockPlugin {
  entryId: string
  moduleName: string
  enabled: boolean
  fiberPhase: 'failed' | 'pending' | 'active' | 'loading' | 'unloading' | null
  readOnlyReason?: 'management-required' | 'unaddressable'
}

function bundle(
  name: string,
  title: string,
  description: string,
  options: Partial<Omit<MockBundle, 'rows'>> & { rows: Array<[string, string, string?]> },
): MockBundle {
  const { rows, ...rest } = options
  return {
    name,
    official: false,
    availability: 'profile',
    enabled: true,
    installed: true,
    optional: false,
    removable: true,
    meta: { title, description },
    ...rest,
    rows: rows.map(([rowId, moduleName, rowTitle]) => ({
      rowId,
      moduleName,
      entryId: `${name}#${rowId}`,
      meta: rowTitle ? { title: rowTitle } : undefined,
    })),
  }
}

export function createDevRpcMock() {
  const bundles: MockBundle[] = [
    bundle('@deepseek-ai/dsh-base', 'Harness 基础层', '会话、工具、LLM 与权限的核心组合，随 DSH 一起提供。', {
      official: true,
      version: '0.2.1-rc.3',
      removable: false,
      readOnlyReason: 'management-required',
      rows: [
        ['tool-bash', '@deepseek-ai/dsh-tool-bash', 'Bash 工具'],
        ['tool-fs', '@deepseek-ai/dsh-tool-fs', '文件读写'],
        ['llm', '@deepseek-ai/dsh-llm', 'LLM 服务'],
        ['settings', '@deepseek-ai/dsh-settings', '用户设置'],
      ],
    }),
    bundle('@natives/dsh-files', '文件', '在主面板里打开 Natives 文件管理器。', {
      version: '0.0.1',
      source: 'link:/Users/me/Natives/integrations/dsh/files',
      rows: [['natives-files', '@natives/dsh-files', '文件面板']],
    }),
    bundle('qiaomu-home-dsh', '个人工作台', '会话搜索、今日重点、待办与专注计时。', {
      version: '0.3.0',
      rows: [['qiaomu-home', 'qiaomu-home-dsh', '工作台']],
    }),
    bundle('plugbox', '插件中心', '浏览、安装与管理插件，并把收录库发布成索引源。', {
      version: '0.3.0',
      source: 'git+https://github.com/Wcof/PlugBox#90026aa',
      rows: [['plugbox-plugin-center', 'plugbox', '插件中心']],
    }),
  ]

  const plugins: MockPlugin[] = bundles.flatMap((item) =>
    item.rows.map((row) => ({
      entryId: row.entryId ?? row.rowId,
      moduleName: row.moduleName,
      enabled: item.enabled,
      fiberPhase: item.enabled ? 'active' : null,
      readOnlyReason: item.readOnlyReason,
    })),
  )

  const indexes = [
    { url: 'https://raw.githubusercontent.com/Wcof/PlugBox/main/index.json', title: { zh: 'PlugBox 插件索引', en: 'PlugBox Plugin Catalog' } },
  ]

  const market = [
    {
      name: 'qiaomu-rss-dsh',
      title: { zh: 'AI RSS 阅读器', en: 'Qiaomu RSS' },
      description: { zh: '在 DeepSeek Harness 中阅读 RSS，与原生 AI 对话伴读文章。', en: 'Read RSS in Harness.' },
      author: 'joeseesun（乔木）',
      repository: { url: 'https://github.com/joeseesun/qiaomu-rss-dsh' },
      metadata: { category: 'reading', keywords: ['乔木 RSS', 'plugbox'], labels: [] },
      versions: [
        {
          version: '0.9.2',
          install: { spec: 'git+https://github.com/joeseesun/qiaomu-rss-dsh#7f2deb7' },
          compatibility: {
            compatible: false,
            requirements: { 'engines.dsh': '0.2.1-rc.2 || 0.2.1-rc.3' },
          },
        },
      ],
      defaultVersion: '0.9.2',
    },
    {
      name: 'qiaomu-home-dsh',
      title: { zh: '个人工作台', en: 'Qiaomu Home' },
      description: { zh: '让 Harness 成为一天的起点。', en: 'Start your day in Harness.' },
      author: 'joeseesun（乔木）',
      repository: { url: 'https://github.com/joeseesun/qiaomu-home-dsh' },
      metadata: { category: 'productivity', keywords: ['乔木 Home', 'plugbox'], labels: [] },
      versions: [
        {
          version: '0.3.1',
          install: { spec: 'git+https://github.com/joeseesun/qiaomu-home-dsh#45f0c1a' },
          compatibility: {
            compatible: false,
            requirements: { 'engines.dsh': '0.2.1-rc.2 || 0.2.1-rc.3' },
          },
        },
      ],
      defaultVersion: '0.3.1',
    },
    {
      name: 'dsh-spotlight',
      title: { zh: 'Spotlight', en: 'Spotlight' },
      description: { zh: '键盘优先的命令面板：⌘K 查找斜杠命令、最近会话与插件设置。', en: 'Keyboard-first command palette.' },
      author: '0xsline',
      homepage: 'https://github.com/0xsline/dsh-spotlight',
      repository: { url: 'https://github.com/0xsline/dsh-spotlight' },
      metadata: { category: 'ui', keywords: ['命令面板', 'third-party'], labels: [] },
      versions: [
        {
          version: '0.0.2',
          install: { spec: 'git+https://github.com/0xsline/dsh-spotlight#471dee2' },
          compatibility: { compatible: true },
        },
      ],
      defaultVersion: '0.0.2',
    },
    {
      name: 'dsh-oh-my-terminal',
      title: { zh: 'Oh My Terminal', en: 'Oh My Terminal' },
      description: { zh: '底部终端面板，支持分屏与会话持久化。', en: 'Bottom terminal panel.' },
      author: 'btsd321',
      repository: { url: 'https://github.com/btsd321/dsh-oh-my-terminal' },
      metadata: { category: 'tools', keywords: ['终端面板', 'third-party'], labels: [] },
      versions: [
        {
          version: '0.4.7',
          install: { spec: 'git+https://github.com/btsd321/dsh-oh-my-terminal#e40df7b' },
          compatibility: { compatible: true },
        },
      ],
      defaultVersion: '0.4.7',
    },
    {
      // 自身条目：面板自己也是被安装的组合包，检查更新要能发现自身的新版
      name: 'plugbox',
      title: { zh: '插件中心', en: 'PlugBox Plugin Center' },
      description: { zh: '浏览、安装与管理插件，并把收录库发布成索引源。', en: 'Browse, install and manage plugins.' },
      author: 'Wcof',
      repository: { url: 'https://github.com/Wcof/PlugBox' },
      metadata: { category: 'tools', keywords: ['PlugBox', 'plugbox'], labels: [] },
      versions: [
        {
          version: '1.0.1',
          install: { spec: 'git+https://github.com/Wcof/PlugBox#f669cdd' },
          compatibility: { compatible: true },
        },
      ],
      defaultVersion: '1.0.1',
    },
  ]

  const bundleNamed = (name: string) => bundles.find((item) => item.name === name)
  const marketEntry = (name: string) => market.find((item) => item.name === name)

  /** 按分支安装的假数据：形状对齐宿主 repoBranches（版本号/engines 取自真实仓库） */
  const branchSets: Record<string, Array<Record<string, unknown>>> = {
    'joeseesun/qiaomu-home-dsh': [
      {
        name: 'main',
        commit: '45f0c1af9b7dacce424eb87c80d4f3a3c5ab4f70',
        version: '0.3.1',
        enginesDsh: '0.2.1-rc.2 || 0.2.1-rc.3',
        bundle: true,
        title: '乔木 Home',
        description: '让 Harness 成为一天的起点：会话搜索、今日重点、待办与专注计时。',
      },
      {
        name: 'codex/dsh-rc5-20261031',
        commit: '0778bbc6da4e3c1f8256104cc29d281b695b59f5',
        version: '0.3.2',
        enginesDsh: '0.2.1-rc.2 || 0.2.1-rc.3 || 0.2.1-rc.4 || 0.2.1-rc.5',
        bundle: true,
        title: '乔木 Home（rc.5 支持）',
        description: '补齐 rc.4/rc.5 的显式支持，其余产品界面与数据格式不变。',
      },
      {
        name: 'docs/readme-only',
        commit: 'd5b180d3d46e89585e062c375e3c6f8218bcc036',
        version: null,
        enginesDsh: null,
        bundle: false,
        title: null,
        description: null,
      },
    ],
    'joeseesun/qiaomu-rss-dsh': [
      {
        name: 'main',
        commit: '7f2deb7ed9583675927663de74d97f70b277c52e',
        version: '0.9.2',
        enginesDsh: '0.2.1-rc.2 || 0.2.1-rc.3',
        bundle: true,
        title: '乔木 RSS',
        description: '在 DeepSeek Harness 中阅读 RSS，与原生 AI 对话伴读文章。',
      },
      {
        name: 'codex/dsh-rc5-20261031',
        commit: '10dc829b1e29264f2df7fb201497cf41b155929d',
        version: '0.9.3',
        enginesDsh: '0.2.1-rc.2 || 0.2.1-rc.3 || 0.2.1-rc.4 || 0.2.1-rc.5',
        bundle: true,
        title: '乔木 RSS（rc.5 支持）',
        description: '补齐 rc.4/rc.5 的显式支持，订阅与阅读界面不变。',
      },
    ],
  }

  function installationOf(name: string) {
    const installed = bundleNamed(name)
    if (installed === undefined) return { status: 'not-installed' as const }
    const latest = marketEntry(name)?.defaultVersion
    if (latest !== undefined && installed.version !== undefined && latest !== installed.version) {
      return { status: 'update-available' as const, installedVersion: installed.version }
    }
    return { status: 'installed' as const, installedVersion: installed.version }
  }

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  async function dispatch(method: string, params: Record<string, unknown>) {
    switch (method) {
      case 'status':
        return { pluginManager: true, pluginMarket: true }
      case 'listBundles':
        return bundles
      case 'listPlugins':
        return plugins
      case 'setBundleEnabled': {
        const target = bundleNamed(String(params.name))
        if (target === undefined) throw Object.assign(new Error('找不到这个插件'), { code: 'unknown-plugin' })
        target.enabled = params.enabled === true
        for (const row of target.rows) {
          const entry = plugins.find((plugin) => plugin.entryId === row.entryId)
          if (entry) {
            entry.enabled = target.enabled
            entry.fiberPhase = target.enabled ? 'active' : null
          }
        }
        return { changed: true, application: 'applied', stage: 'enable', target: target.name, enabled: target.enabled }
      }
      case 'setPluginEnabled': {
        const entry = plugins.find((plugin) => plugin.entryId === String(params.entryId))
        if (entry === undefined) throw Object.assign(new Error('找不到该插件'), { code: 'unknown-plugin' })
        entry.enabled = params.enabled === true
        entry.fiberPhase = entry.enabled ? 'active' : null
        return { changed: true, application: 'applied', stage: 'enable', target: entry.entryId, enabled: entry.enabled }
      }
      case 'removeBundle': {
        const index = bundles.findIndex((item) => item.name === String(params.name))
        if (index < 0) throw Object.assign(new Error('找不到这个插件'), { code: 'unknown-plugin' })
        bundles.splice(index, 1)
        return { changed: true, application: 'applied', stage: 'remove', target: String(params.name) }
      }
      case 'installBundle': {
        const spec = String(params.spec)
        await sleep(700)
        // git spec 的包名在仓库路径里，分支名可能带斜杠，不能简单取最后一段
        const name = spec.startsWith('git+')
          ? /github\.com\/[^/]+\/([^/#]+)/.exec(spec)?.[1] ?? spec
          : spec
        const existing = bundleNamed(name)
        if (existing) {
          existing.source = spec
          if (spec.includes('#')) existing.version = '0.3.2'
          else existing.version = marketEntry(name)?.defaultVersion ?? existing.version
          return { changed: true, application: 'applied', stage: 'install', target: name }
        }
        bundles.push(
          bundle(name, name, `从 ${spec} 安装的组合包。`, {
            version: '0.1.0',
            source: spec,
            rows: [[name, name, name]],
          }),
        )
        return { changed: true, application: 'applied', stage: 'install', target: name }
      }
      case 'repoBranches': {
        const repo = String(params.repo)
        await sleep(250)
        return { repo, branches: branchSets[repo] ?? [] }
      }
      case 'listIndexes':
        return indexes
      case 'setIndexes': {
        const urls = params.urls as string[]
        indexes.splice(0, indexes.length, ...urls.map((url) => ({ url, title: { zh: url, en: url } })))
        return null
      }
      case 'searchMarket': {
        const url = String(params.url)
        const query = (params.query ?? {}) as { text?: string; offset?: number; limit?: number }
        const text = (query.text ?? '').trim().toLowerCase()
        const entries = market
          .filter((item) => {
            if (text === '') return true
            const haystack = [item.name, item.author, JSON.stringify(item.title), JSON.stringify(item.description)]
              .join(' ')
              .toLowerCase()
            return haystack.includes(text)
          })
          .map((item) => ({ ...item, installation: installationOf(item.name) }))
        return {
          url,
          title: { zh: 'PlugBox 插件索引', en: 'PlugBox Plugin Catalog' },
          fetchedAt: Date.now(),
          entries,
          total: entries.length,
          nextOffset: null,
        }
      }
      default:
        throw Object.assign(new Error(`未知的调用：${method}`), { code: 'unknown-method' })
    }
  }

  return function handle(request: IncomingMessage, response: ServerResponse, next: () => void): void {
    if (request.method !== 'POST') {
      next()
      return
    }
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      let body: { method?: string; params?: Record<string, unknown> } = {}
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      } catch {
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ ok: false, error: { code: 'invalid-json', message: 'bad json' } }))
        return
      }
      dispatch(body.method ?? '', body.params ?? {})
        .then((result) => {
          response.writeHead(200, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ ok: true, result }))
        })
        .catch((error: { code?: string; message?: string }) => {
          response.writeHead(400, { 'content-type': 'application/json' })
          response.end(
            JSON.stringify({
              ok: false,
              error: { code: error.code ?? 'operation-error', message: error.message ?? 'failed' },
            }),
          )
        })
    })
  }
}
