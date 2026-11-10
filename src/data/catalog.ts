/**
 * 插件收录库 —— 本文件是索引源（index.json）的唯一维护入口。
 * 按创作者划分：收录新插件时在对应创作者的 plugins 下追加；
 * 新的创作者新增一个 CreatorGroup 分组。第三方插件不在本库维护。
 *
 * 注意：商场页面不再读这里的数据，它直接问宿主的插件市场服务；
 * 本库只负责生成对外发布的索引文件。
 *
 * 这里的插件描述都刻意不提具体宿主：同一个插件经适配器转换后应当能落到不同宿主上，
 * 「它是某某引擎专用插件」属于宿主侧信息，不属于插件本身。
 */

/** 开发指南 / 开发资料入口（待确认：如有 Harness 官方开发文档再替换） */
export const DEV_GUIDE_URL = 'https://github.com/joeseesun'

export interface Creator {
  /** GitHub 用户名，同时作为插件 author 字段 */
  id: string
  /** 中文名等展示名 */
  name: string
  homepage: string
}

/** 收录条目：字段用于生成索引，不参与运行时 */
export interface CatalogPlugin {
  id: string
  name: string
  alias: string
  description: string
  version: string
  author: string
  authorName?: string
  license: string
  source: 'official' | 'third-party'
  repo: string
  icon?: string
  configSchema?: Array<{
    key: string
    label: string
    type: 'text' | 'number' | 'boolean' | 'select'
    options?: string[]
    step?: number
  }>
}

export interface CreatorGroup {
  creator: Creator
  plugins: CatalogPlugin[]
}

export const OFFICIAL_REGISTRY: CreatorGroup[] = [
  {
    // 插件中心自身作为第一款官方插件置于首位
    creator: { id: 'Wcof', name: 'PlugBox', homepage: 'https://github.com/Wcof/PlugBox' },
    plugins: [
      {
        id: 'plugbox',
        name: '插件中心',
        alias: 'PlugBox',
        description:
          '插件适配与管理工具：直接读写宿主里真实的插件状态（安装、启停、卸载、索引源），打开即提示可更新版本；同时把自己记录的目录发布成宿主可订阅的插件索引。',
        version: '0.5.3',
        author: 'Wcof',
        license: 'MIT',
        source: 'official',
        repo: 'Wcof/PlugBox',
        icon: 'puzzle',
      },
      {
        id: '@dsh/files',
        name: '文件工具',
        alias: 'DSH Files',
        description:
          '左侧「文件」页面提供目录浏览、搜索、预览编辑、上传、复制移动、废纸篓和归档，同时提供 25 个原生文件工具。支持只读模式、编辑冲突保护与变更自动同步。',
        version: '0.2.0',
        author: 'Wcof',
        license: 'MIT',
        source: 'official',
        repo: 'Wcof/dsh-files',
        icon: 'folder-open',
      },
    ],
  },
  {
    creator: { id: 'joeseesun', name: '乔木', homepage: 'https://github.com/joeseesun' },
    plugins: [
      {
        id: 'qiaomu-rss-dsh',
        name: 'AI RSS 阅读器',
        alias: '乔木 RSS',
        description:
          '在 DeepSeek Harness 中阅读 RSS，与原生 AI 对话伴读文章；支持 OPML 导入导出与播客转写阅读。',
        version: '0.9.2',
        author: 'joeseesun',
        authorName: '乔木',
        license: 'GPL-3.0-only',
        source: 'official',
        repo: 'joeseesun/qiaomu-rss-dsh',
        icon: 'rss',
        configSchema: [{ key: 'refreshInterval', label: '刷新间隔（分钟）', type: 'number', step: 5 }],
      },
      {
        id: 'qiaomu-reader-dsh',
        name: '电子书阅读器',
        alias: '乔木阅读',
        description:
          '在 DeepSeek Harness 中阅读 EPUB、PDF、TXT，划线批注、导出阅读笔记与 AI 伴读。',
        version: '1.1.1',
        author: 'joeseesun',
        authorName: '乔木',
        license: 'GPL-3.0-only',
        source: 'official',
        repo: 'joeseesun/qiaomu-reader-dsh',
        icon: 'book-open',
        configSchema: [
          { key: 'theme', label: '阅读主题', type: 'select', options: ['跟随系统', '浅色', '深色'] },
        ],
      },
      {
        id: 'qiaomu-ui-learn-dsh',
        name: '学习 UI 设计',
        alias: '乔木 UI 学习',
        description:
          '乔木 UI 学习的 Harness 迁移版：13561 条设计参考、106 个交互标本、审美测验与 Markdown 学习笔记。',
        version: '0.1.2',
        author: 'joeseesun',
        authorName: '乔木',
        license: 'MIT',
        source: 'official',
        repo: 'joeseesun/qiaomu-ui-learn-dsh',
        icon: 'palette',
      },
      {
        id: 'qiaomu-home-dsh',
        name: '个人工作台',
        alias: '乔木 Home',
        description:
          '乔木 Home：让 Harness 成为一天的起点。会话搜索、今日重点、待办、记录与专注计时。',
        version: '0.3.1',
        author: 'joeseesun',
        authorName: '乔木',
        license: 'GPL-3.0-only',
        source: 'official',
        repo: 'joeseesun/qiaomu-home-dsh',
        icon: 'layout-dashboard',
        configSchema: [{ key: 'startAtLogin', label: '启动 Harness 时打开工作台', type: 'boolean' }],
      },
    ],
  },
]

/**
 * 第三方收录区：经核实的社区插件，不进官方收录库（当前收录的这批均来自 DSH 生态）。
 * 收录标准与官方库一致：仓库真实存在、确为 DSH 插件（dsh plugin add 可装 /
 * 声明 dsh.bundle），版本与许可证核对自仓库 package.json / LICENSE。
 */
export const THIRD_PARTY_REGISTRY: CreatorGroup[] = [
  {
    creator: { id: '0xsline', name: '0xsline', homepage: 'https://github.com/0xsline' },
    plugins: [
      {
        id: 'dsh-spotlight',
        name: 'Spotlight',
        alias: '命令面板',
        description:
          '适用于 DeepSeek Harness Web 的键盘优先命令面板：⌘K 模糊查找斜杠命令、最近会话、UI 操作与插件设置。',
        version: '0.0.2',
        author: '0xsline',
        license: 'MIT',
        source: 'third-party',
        repo: '0xsline/dsh-spotlight',
        icon: 'command',
      },
    ],
  },
  {
    creator: { id: 'asxiuxiu', name: 'asxiuxiu', homepage: 'https://github.com/asxiuxiu' },
    plugins: [
      {
        id: 'dsh-quick-open',
        name: 'Quick Open',
        alias: '快速打开',
        description:
          'VSCode 风格的 Ctrl+P 快速打开：工作区模糊文件搜索、文件内查找，并可将选中代码引用插入 AI 对话。',
        version: '0.3.2',
        author: 'asxiuxiu',
        license: 'MIT',
        source: 'third-party',
        repo: 'asxiuxiu/dsh-quick-open',
        icon: 'folder-open',
      },
    ],
  },
  {
    creator: { id: 'btsd321', name: 'btsd321', homepage: 'https://github.com/btsd321' },
    plugins: [
      {
        id: 'dsh-oh-my-terminal',
        name: 'Oh My Terminal',
        alias: '终端面板',
        description:
          'DSH GUI 底部终端面板：基于 node-pty 与 xterm.js 的多会话终端，支持分屏、会话持久化与跨平台（ConPTY / openpty）。',
        version: '0.4.7',
        author: 'btsd321',
        license: 'Apache-2.0',
        source: 'third-party',
        repo: 'btsd321/dsh-oh-my-terminal',
        icon: 'square-terminal',
      },
    ],
  },
  {
    creator: {
      id: 'Ebony-Vinyl',
      name: 'Ebony-Vinyl',
      homepage: 'https://github.com/Ebony-Vinyl',
    },
    plugins: [
      {
        id: 'dsh-our-free-model',
        name: 'Our Free Model',
        alias: '免费模型接入',
        description:
          '免登录、免 API Key 使用 DeepSeek V4.1 Flash、Kimi K3 等免费模型，含用量看板与 OpenAI 兼容本地转发。',
        version: '2.7.3',
        author: 'Ebony-Vinyl',
        license: 'MIT',
        source: 'third-party',
        repo: 'Ebony-Vinyl/dsh-our-free-model',
        icon: 'zap',
      },
    ],
  },
  {
    creator: { id: 'op7418', name: '归藏', homepage: 'https://github.com/op7418' },
    plugins: [
      {
        id: 'dsh-guizang-design',
        name: '歸藏设计',
        alias: '归藏设计',
        description:
          '歸藏设计：把内容生产 skill 装进 Harness——网页 PPT、图文卡片、网页排版、去 AI 味，共用一套设计系统；带作品库、内容生产工作流与语气档案。',
        version: '0.1.0',
        author: 'op7418',
        authorName: '归藏',
        license: 'AGPL-3.0-only',
        source: 'third-party',
        repo: 'op7418/dsh-guizang-design',
        icon: 'palette',
      },
    ],
  },
]
