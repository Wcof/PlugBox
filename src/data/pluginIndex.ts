import { OFFICIAL_REGISTRY, THIRD_PARTY_REGISTRY } from './catalog'
import { authorLabel } from '../types/plugin'
import { BRAND } from '../core/protocol/brand'

/**
 * PlugBox 插件市场索引源。
 *
 * 产出的是目标宿主索引格式（当前两个宿主都用 cordis 系 format 1），
 * 供宿主的「发现」页添加索引源后浏览本 Box 收录的全部插件。
 * 收录库本身是宿主中立的；要发布成别的宿主能读的格式，加对应适配器的输出函数即可。
 */

interface Bilingual {
  en: string
  zh: string
}

/** 索引里的展示文案既可以是单语字符串，也可以是 { en, zh } 映射 */
type Localized = Bilingual | string

interface IndexCategory {
  title: Bilingual
}

interface IndexVersion {
  version: string
  publishTimestamp: number
  source: { type: 'git'; url: string; commit: string }
  /** 与包自身 engines 对应；索引格式只定义 dsh，缺省表示该版本未声明 DSH 版本要求 */
  engines: { dsh?: string }
}

interface IndexPlugin {
  name: string
  title: Localized
  description: Localized
  author?: string
  icon?: string
  homepage: string
  repository: { url: string }
  metadata: {
    category: string
    keywords: string[]
    labels: string[]
    sortKeys: Record<string, never>
  }
  versions: IndexVersion[]
}

export interface PluginCatalogIndex {
  format: 1
  title: Bilingual
  description: Bilingual
  metadata: {
    categories: Record<string, IndexCategory>
    labels: Record<string, never>
    sortKeys: Record<string, never>
  }
  plugins: IndexPlugin[]
}

/** 插件分类（展示于「发现」页的分组） */
const CATEGORIES: Record<string, IndexCategory> = {
  reading: { title: { en: 'Reading', zh: '阅读' } },
  learning: { title: { en: 'Learning', zh: '学习' } },
  productivity: { title: { en: 'Productivity', zh: '效率' } },
  ui: { title: { en: 'UI Enhancements', zh: '界面增强' } },
  tools: { title: { en: 'Tools', zh: '工具' } },
  models: { title: { en: 'Models & Providers', zh: '模型与供应商' } },
}

/** 每个收录插件的英文描述（与中文描述同义） */
const DESCRIPTIONS_EN: Record<string, string> = {
  '@dsh/files':
    '25 native agent tools for browsing, reading, writing, searching, previewing, archiving and watching local files, with batch operations, read-only mode and edit conflict checks. No separate UI.',
  'plugbox':
    'A plugin center that reads and writes live plugin state (install, enable, remove, index sources) and adapts the same catalog to whichever supported host it runs in.',
  'qiaomu-rss-dsh':
    'Read RSS in DeepSeek Harness with native AI companion reading; supports OPML import/export and podcast transcript reading.',
  'qiaomu-reader-dsh':
    'Read EPUB, PDF and TXT in DeepSeek Harness with highlights, reading notes export and AI companion.',
  'qiaomu-ui-learn-dsh':
    'Harness port of Qiaomu UI Learn: 13,561 design references, 106 interaction specimens, aesthetic quizzes and Markdown study notes.',
  'qiaomu-home-dsh':
    'Qiaomu Home makes Harness the start of your day: conversation search, daily focus, todos, notes and a focus timer.',
  'dsh-spotlight':
    'A keyboard-first command palette for DeepSeek Harness Web: fuzzy-find slash commands, recent sessions, UI actions and plugin settings.',
  'dsh-quick-open':
    'VSCode-style Ctrl+P quick open for DSH: fuzzy workspace file search, in-file find, and code reference insertion into AI chats.',
  'dsh-oh-my-terminal':
    'A bottom terminal panel for DSH GUI: multi-session terminal on node-pty and xterm.js with split panes, session persistence and cross-platform support (ConPTY / openpty).',
  'dsh-our-free-model':
    'Use free models such as DeepSeek V4.1 Flash and Kimi K3 without login or API keys; includes a usage dashboard and an OpenAI-compatible local proxy.',
  'dsh-guizang-design':
    'Guizang Design brings a content-production toolkit into Harness: magazine-style web PPT decks, social cards, long-form page layout and a Chinese AI-ese remover, all on one design system, with a works gallery, workflows and a voice profile.',
}

const CATEGORY_BY_PLUGIN: Record<string, string> = {
  '@dsh/files': 'tools',
  'plugbox': 'tools',
  'qiaomu-rss-dsh': 'reading',
  'qiaomu-reader-dsh': 'reading',
  'qiaomu-ui-learn-dsh': 'learning',
  'qiaomu-home-dsh': 'productivity',
  'dsh-spotlight': 'ui',
  'dsh-quick-open': 'ui',
  'dsh-oh-my-terminal': 'tools',
  'dsh-our-free-model': 'models',
  'dsh-guizang-design': 'productivity',
}

/** 英文展示名（title 的 en 键；zh 键使用收录库的展示名称） */
const TITLE_EN: Record<string, string> = {
  '@dsh/files': 'DSH Files',
  'plugbox': `${BRAND.name} Plugin Center`,
  'qiaomu-rss-dsh': 'Qiaomu RSS',
  'qiaomu-reader-dsh': 'Qiaomu Reader',
  'qiaomu-ui-learn-dsh': 'Qiaomu UI Learn',
  'qiaomu-home-dsh': 'Qiaomu Home',
  'dsh-spotlight': 'Spotlight',
  'dsh-quick-open': 'Quick Open',
  'dsh-oh-my-terminal': 'Oh My Terminal',
  'dsh-our-free-model': 'Our Free Model',
  'dsh-guizang-design': 'Guizang Design',
}

/**
 * 各插件的项目图标，直接引用其所在仓库的图标文件（按收录版本的提交固定）；
 * 项目未提供图标的（乔木 RSS、Spotlight、Quick Open）使用作者 GitHub 头像。
 * 全部 URL 已用 curl 核实（200，2026-10-30）。
 */
const INDEX_ICONS: Record<string, string> = {
  '@dsh/files': 'https://github.com/Wcof.png',
  'plugbox':
    `https://raw.githubusercontent.com/${BRAND.repository}/main/icons/plugbox.svg`,
  'qiaomu-rss-dsh': 'https://github.com/joeseesun.png',
  'qiaomu-reader-dsh':
    'https://raw.githubusercontent.com/joeseesun/qiaomu-reader-dsh/af0a5a283deee91157efd42eeb2b06372c79b230/icon.svg',
  'qiaomu-ui-learn-dsh':
    'https://raw.githubusercontent.com/joeseesun/qiaomu-ui-learn-dsh/80ac9520f19bfdea79a906f5134d80a2bf68a099/icon.svg',
  'qiaomu-home-dsh':
    'https://raw.githubusercontent.com/joeseesun/qiaomu-home-dsh/45f0c1af9b7dacce424eb87c80d4f3a3c5ab4f70/icon.svg',
  'dsh-spotlight': 'https://github.com/0xsline.png',
  'dsh-quick-open': 'https://github.com/asxiuxiu.png',
  'dsh-oh-my-terminal':
    'https://raw.githubusercontent.com/btsd321/dsh-oh-my-terminal/e40df7b16a162b4df57bd9f77001474d347da748/icon.jpg',
  'dsh-our-free-model':
    'https://raw.githubusercontent.com/Ebony-Vinyl/dsh-our-free-model/5fcb5faf4da7843cb0d0e638ce665dd6cd4aafc1/icon.svg',
  'dsh-guizang-design':
    'https://raw.githubusercontent.com/op7418/dsh-guizang-design/c0bc1ec0accf6312f6e1e066cabb460b54da2b97/icon.png',
}

/**
 * 各插件当前收录版本的来源登记表。
 * 「发现」页校验（deepseek-ai/deepseek-harness packages/util/plugin-market-index）要求：
 * - publishTimestamp 为整数 Unix 秒；
 * - source.type 为 "npm" 或 "git"，git 必须携带 https 仓库 URL 与 40 位小写 commit SHA。
 * 数据来源（gh api 核实于 2026-10-30）：publishTimestamp 取 Releases latest 的 published_at，
 * 未发 Release 或 Release 落后于收录版本的（dsh-spotlight、dsh-quick-open）取 package.json
 * 最后一次变更提交的 committer.date；commit 取 Release tag / 变更提交的完整 SHA。
 *
 * enginesDsh 必须镜像该 commit 上 package.json 的 `engines.dsh`（原样抄写，不做范围加工），
 * 包没声明就整个省略——索引里缺省的含义是「任意 DSH 版本」，写成 {} 等于向市场宣称无要求。
 * 宿主装完会用 `semver.satisfies(运行时版本, engines.dsh, { includePrerelease: true })` 复核，
 * 索引漏登记时市场照常显示「安装」，用户点下去才在安装阶段被拒并回滚。
 * 值已逐条用 curl 拉取对应 commit 的 package.json 核实（2026-10-31）。
 */
const VERSION_SOURCES: Record<
  string,
  { publishTimestamp: number; commit: string; enginesDsh?: string }
> = {
  '@dsh/files': {
    publishTimestamp: 1794285787,
    commit: '9dc5e08caf579486b468ce3265b14fe4ba4c05ee',
    enginesDsh: '>=0.2.2-rc.1 <0.3.0',
  }, // v0.1.1，package.json 变更提交；2026-11-10 核对仓库清单与 MIT 许可证
  'plugbox': { publishTimestamp: 1793318933, commit: '26f9321ada24ceff750e9e565d91bef3e519c52d' }, // 本仓库 main；postbuild 由 scripts/sync-self-entry.mjs 同步到最新提交
  'qiaomu-rss-dsh': {
    publishTimestamp: 1793168802,
    commit: '7f2deb7ed9583675927663de74d97f70b277c52e',
    enginesDsh: '0.2.1-rc.2 || 0.2.1-rc.3',
  }, // release v0.9.2 · 2026-10-28T06:26:42Z
  'qiaomu-reader-dsh': {
    publishTimestamp: 1793158004,
    commit: 'af0a5a283deee91157efd42eeb2b06372c79b230',
    enginesDsh: '0.2.1-rc.2 || 0.2.1-rc.3',
  }, // release v1.1.1 · 2026-10-28T03:26:44Z
  'qiaomu-ui-learn-dsh': {
    publishTimestamp: 1793158013,
    commit: '80ac9520f19bfdea79a906f5134d80a2bf68a099',
    enginesDsh: '0.2.1-rc.3',
  }, // release v0.1.2 · 2026-10-28T03:26:53Z
  'qiaomu-home-dsh': {
    publishTimestamp: 1793157999,
    commit: '45f0c1af9b7dacce424eb87c80d4f3a3c5ab4f70',
    enginesDsh: '0.2.1-rc.2 || 0.2.1-rc.3',
  }, // release v0.3.1 · 2026-10-28T03:26:39Z
  'dsh-spotlight': { publishTimestamp: 1787561813, commit: '471dee2c528bc7203669f3e540d38181b657abe4' }, // package.json 提交 · 2026-08-24T08:56:53Z；engines 只有 node
  'dsh-quick-open': { publishTimestamp: 1791618520, commit: '81b04057d2ce6f7ad585b0d94a3de895c4f26143' }, // package.json 提交 · 2026-10-10T07:48:40Z；无 engines，DSH 要求写在 peerDependencies
  'dsh-oh-my-terminal': { publishTimestamp: 1793184490, commit: 'e40df7b16a162b4df57bd9f77001474d347da748' }, // release tag v0.4.7 解包 · 2026-10-28T10:48:10Z；engines 只有 node
  'dsh-our-free-model': { publishTimestamp: 1793344626, commit: '5fcb5faf4da7843cb0d0e638ce665dd6cd4aafc1' }, // release v2.7.3 · 2026-10-30T07:17:06Z（annotated tag 的对象是 4253688，取解引用后的提交）；engines 只有 node
  'dsh-guizang-design': {
    publishTimestamp: 1793371802,
    commit: 'c0bc1ec0accf6312f6e1e066cabb460b54da2b97',
    enginesDsh: '>=0.2.1-rc.2 <0.3.0',
  }, // v0.1.0，未发 Release；取 package.json 最后变更提交 · 2026-10-30T14:50:02Z
}

/**
 * 社区目录条目：由 `scripts/scan-dshhub.mjs` 体检 + `scripts/build-community.mjs` 生成，
 * 存在 `data/community/entries.json`，不进前端包，也不进精选索引。
 * 每条都核实过仓库可达、package.json 声明 dsh.bundle、版本为 semver；
 * 但 engines.dsh 仍以包自己的声明为准（没声明就省略，语义是「任意版本」）。
 */
export interface CommunityEntry {
  id: string
  repo: string
  version: string
  commit: string
  enginesDsh: string | null
  license: string | null
  category: string
  stars: number
  updated: number
  descriptionZh: string
  descriptionEn: string
}

/** 社区目录索引：与精选索引同格式，单独发布，供需要「全量」的用户订阅 */
export function buildCommunityIndex(entries: CommunityEntry[]): PluginCatalogIndex {
  const plugins = entries.map((entry): IndexPlugin => {
    const url = `https://github.com/${entry.repo}`
    const owner = entry.repo.split('/')[0]
    const description = entry.descriptionZh || entry.descriptionEn || `${entry.id}（社区插件）`
    // 英文文案与中文相同时只写一份字符串，避免索引里重复几千条同样的文本
    const localizedDescription =
      entry.descriptionEn && entry.descriptionEn !== description
        ? { zh: description, en: entry.descriptionEn }
        : description
    return {
      name: entry.id,
      title: entry.id,
      description: localizedDescription,
      author: owner,
      icon: `https://github.com/${owner}.png`,
      homepage: url,
      repository: { url },
      metadata: {
        category: entry.category,
        // 标记词决定面板上那枚来源标签：catalogMarker → 「本 Box 收录」，communityMarker 说明这条来自第三方站点同步
        keywords: [BRAND.catalogMarker, BRAND.communityMarker],
        labels: [],
        sortKeys: {},
      },
      versions: [
        {
          version: entry.version,
          publishTimestamp: Math.floor(entry.updated / 1000),
          source: { type: 'git', url, commit: entry.commit },
          engines: entry.enginesDsh === null ? {} : { dsh: entry.enginesDsh },
        },
      ],
    }
  })

  return {
    format: 1,
    title: { en: `${BRAND.name} Community Catalog`, zh: `${BRAND.name} 社区插件目录` },
    description: {
      en: 'Community catalog built with repo-level verification: the repository is reachable, its package.json declares a plugin bundle, and the version is a real release. The current entries come from the DSH-side community directory.',
      zh: '社区插件目录，逐条做过仓库级核实：仓库可达、package.json 声明了组合包、版本号来自包本身。当前条目来源为 DSH 生态的社区站点。',
    },
    metadata: {
      categories: CATEGORIES,
      labels: {},
      sortKeys: {},
    },
    plugins,
  }
}

/** 生成本 Box 的插件索引（cordis 系 format 1）；收录库更新后索引随之更新 */
export function buildPluginCatalogIndex(): PluginCatalogIndex {
  const plugins = [...OFFICIAL_REGISTRY, ...THIRD_PARTY_REGISTRY].flatMap((group) =>
    group.plugins.map((plugin): IndexPlugin => {
      const versionSource = VERSION_SOURCES[plugin.id]
      if (versionSource === undefined) {
        throw new Error(
          `pluginIndex: ${plugin.id} 缺少版本来源登记，请在 VERSION_SOURCES 中登记 publishTimestamp、commit SHA 与（若包声明了）engines.dsh`,
        )
      }
      const url = `https://github.com/${plugin.repo}`
      return {
        name: plugin.id,
        title: { zh: plugin.name, en: TITLE_EN[plugin.id] ?? plugin.name },
        description: {
          en: DESCRIPTIONS_EN[plugin.id] ?? plugin.description,
          zh: plugin.description,
        },
        author: authorLabel(plugin.author, plugin.authorName, true),
        icon: INDEX_ICONS[plugin.id],
        homepage: url,
        repository: { url },
        metadata: {
          category: CATEGORY_BY_PLUGIN[plugin.id] ?? 'tools',
          // 只是「收录在本 Box 的索引里」，不等于宿主官方；官方的说法留给 labels 里的 official
          keywords: [plugin.alias, BRAND.catalogMarker],
          labels: [],
          sortKeys: {},
        },
        versions: [
          {
            version: plugin.version,
            publishTimestamp: versionSource.publishTimestamp,
            source: { type: 'git', url, commit: versionSource.commit },
            engines:
              versionSource.enginesDsh === undefined ? {} : { dsh: versionSource.enginesDsh },
          },
        ],
      }
    }),
  )

  return {
    format: 1,
    title: { en: `${BRAND.name} Plugin Catalog`, zh: `${BRAND.name} 插件索引` },
    description: {
      en: `Curated ${BRAND.name} catalog for engine-layer and agent tools: verified plugins, readable from any host we adapt to.`,
      zh: `${BRAND.name} 维护的插件收录索引：面向引擎层与智能体层工具，收录经过核实的插件，可被任意已适配宿主读取。`,
    },
    metadata: {
      categories: CATEGORIES,
      labels: {},
      sortKeys: {},
    },
    plugins,
  }
}
