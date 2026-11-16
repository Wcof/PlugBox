# PlugBox 架构说明（v1.0）

> 一句话：**PlugBox 不再属于任何引擎**。它把「插件是什么」和「某个宿主怎么装插件」拆成两层——
> 前者在核心层，后者在适配层。新增一个宿主 = 新增一个适配器，核心不动。

## 1. 为什么要拆

原项目（DeepSeekBox）是 DeepSeek Harness 的专用插件中心：包名、UI 文案、挂载路由、索引标记、
甚至「怎么判断一个包能不能装」全都写着 DSH 的字样。要变成「面向所有支持自定义插件的引擎层与
智能体层工具的插件适配与管理工具」，难的不是改名，而是回答：**哪些东西一旦写死，换宿主就必然要改代码？**

答案有四类，它们各自的处理方式构成了本架构的四条边界：

| 类别 | 例子 | 归属 |
|---|---|---|
| 通用概念 | 插件身份、版本、资源、来源、安装/启停 | 核心层抽象 |
| 宿主协议字段 | `dsh.bundle.patch`、`engines.dsh`、`labels.official` | 保留，但由适配器持有 |
| 宿主行为 | 组合包 patch、侧栏槽位注册、RPC 方法名 | 适配器实现 |
| 品牌身份 | PlugBox 自己的名字、收录标记、索引 URL | `BRAND` 单点常量 |

关键取舍：`dsh.bundle`、`engines.dsh` 这些**不是文案，是宿主的机器契约**，删掉就装不进去。
它们的正确归宿不是「删除」而是「搬迁」——从散落全仓库，搬到一个地方：适配器。

## 2. 目录结构

```
plugbox/
├── index.js                      # 宿主进程半边：挂载静态产物 + RPC（= DSH 适配器的服务端实现）
├── client.js                     # 宿主浏览器半边：注册侧栏入口与主面板
├── cordis.patch.yml              # 宿主组合包 patch（宿主专属机制）
├── icons/plugbox.svg             # 宿主侧展示图标
├── locale/*.json                 # 宿主读取的双语展示元数据
├── web/                          # Vue 构建产物（随包提交）
│
├── src/
│   ├── core/                     # ★ 核心层：与任何引擎/宿主无关
│   │   ├── protocol/
│   │   │   ├── brand.ts          # 产品身份常量：名字、包名、收录标记、索引文件名
│   │   │   ├── plugin.ts         # 插件的中立身份：版本、要求、资源、出处
│   │   │   ├── catalog.ts        # 索引条目与出处判定规则
│   │   │   └── version.ts        # 版本比较与「是否兼容」三态
│   │   ├── manifest/index.ts     # 清单双向转换：宿主 manifest ⇄ 中间视图 ⇄ canonical
│   │   ├── resources/index.ts    # 资源映射与降级：canonical 资源 → 宿主申领
│   │   └── lifecycle/index.ts    # 生命周期动词与操作结果
│   │
│   ├── adapters/                 # ★ 适配层：每个目标宿主一份
│   │   ├── types.ts              # HostAdapter 契约（扩展点全在这里）
│   │   ├── registry.ts           # 登记表与当前宿主解析
│   │   ├── cordis.ts             # Cordis 协议族共用的适配器工厂
│   │   ├── index.ts              # 对外出口
│   │   ├── dsh/                  # DeepSeek Harness（已实测）
│   │   └── zcode-dsh/            # zcode 的 DeepSeek Harness（未实测）
│   │
│   ├── host/transport.ts         # 运行时宿主上下文：按适配器求 RPC 相对路径
│   ├── services/pluginService.ts # 唯一接口层：端点与出处判定均取自适配器
│   ├── stores/pluginCenter.ts    # 状态 owner
│   ├── components/…              # UI
│   ├── data/                     # 收录库、索引生成器、置顶判据
│   └── types/plugin.ts           # UI 侧形态
│
└── scripts/
    ├── check-adapters.mjs        # 适配器约束 + 宿主侧一致性断言
    ├── check-pinned-index.mjs    # 置顶判据断言
    ├── validate-bundle.mjs       # 组合包自检（宿主安装门槛）
    └── validate-index.mjs        # 索引格式校验
```

## 3. 核心层职责

| 模块 | 负责 | 明确不负责 |
|---|---|---|
| `core/protocol/plugin.ts` | 插件的中立身份、版本与来源、要求、资源、出处 | 任何宿主的字段名与命令名 |
| `core/protocol/catalog.ts` | 索引条目出处判定（vendor / curated / third-party） | 「哪个标记算官方」——规则由适配器注入 |
| `core/protocol/version.ts` | 版本分段比较；兼容性三态，答不上来就 `unknown` | semver 范围语法、prerelease 策略 |
| `core/protocol/brand.ts` | PlugBox 自己的名字与标记词 | 宿主的任何名字 |
| `core/manifest` | 双向转换；中间视图保留宿主专属字段 | 判断某个包在这宿主装不装得上（`pluginGate` 归适配器） |
| `core/resources` | 资源映射，列出「宿主接不住的资源」供降级 | 资源在宿主里的装配细节 |
| `core/lifecycle` | 生命周期动词与统一操作结果 | 具体怎么调（由 `HostAdapter.methods` 翻译） |

**中间视图（ManifestView）是这次设计的关键件。** 宿主的插件资格字段（如 `dsh.bundle.patch`）
既不能写进 canonical（会把核心污染回去），也不能丢（丢了就装不上），于是单独留 `hostFields` 原样往返。

## 4. 适配层职责

一个适配器要回答六个问题，全在 `src/adapters/types.ts`：

```ts
interface HostAdapter {
  id, displayName, family, verified, openQuestions?   // 是谁、能不能信
  ui:        UiBinding       // 挂哪：路由前缀、面板 id、locale 命名空间、UI 槽位
  labels:    LabelBinding    // 「xx 官方 / PlugBox 收录 / 第三方」这三句话怎么写
  catalog:   CatalogBinding  // 索引格式、哪些标记算官方、自己的收录标记词
  manifest:  ManifestBinding // 清单读写、字段名↔命名空间键、插件门槛
  resources: ResourceBinding // canonical 资源 → 宿主申领；接不住返回 null
  methods:   Record<CanonicalMethod, string>  // 生命周期动词 → 宿主真实方法名
  vendorPackageScopes: readonly string[]      // 哪些 npm scope 算宿主干系
  installSpec(plugin, version?): string | undefined
  gitSource: { parse(source?): { ref, directory? }; branchSpec(repo, branch, directory?): string }
}
```

**四条硬约定**

1. `verified: false` 的适配器必须写明 `openQuestions`，且**永远不会被自动选为当前宿主**
   （`resolveAdapter()` 只回退到已实测的那个）。
2. 挂载前缀全局唯一——`check:adapters` 会拦下两个适配器抢同一个前缀。
3. 接不住的资源必须返回 `null`，不许假装接住；UI 据此降级而不是报错。
4. 外部只能 import `src/adapters/index.ts`，不许深入具体宿主目录。

### 内置适配器

| id | 宿主 | 协议族 | 前缀 | 状态 |
|---|---|---|---|---|
| `dsh` | DeepSeek Harness | cordis | `/plugbox` | 已实测 |
| `zcode-dsh` | zcode 的 DeepSeek Harness | cordis | `/plugbox-zcode` | **未实测**，4 项待核实 |

两者跑在同一套 Cordis 运行时上，协议实现共用 `cordis.ts` 的工厂，差异只是一份 descriptor。
第三个同族宿主的成本：写一份 descriptor + 往 `registry.ts` 加一行。

### 新增一个宿主的步骤（扩展点）

1. `src/adapters/<id>/index.ts` 提供 `HostAdapter`；同族宿主直接 `createCordisAdapter(descriptor)`。
2. 在 `src/adapters/registry.ts` 的 `ADAPTERS` 里登记。
3. 若有独立进程半边，照 `index.js` / `client.js` 写一份；`check:adapters` 会核对前缀与 patch 是否一致。
4. `npm run check:adapters`。

> **已知边界**：根目录 `package.json` 仍带 `dsh` 声明块。这是刻意的——宿主安装时读的是这份文件，
> 挪进子目录会让 DSH 装不上。它属于「适配器贡献的内容被烘进发布 manifest」。
> 将来若两个宿主的字段语义冲突，正确解法是按宿主分开发布产物（`build --host <id>`）。
>
> 另：`src/components`、`src/stores`、`src/services` 目前还在顶层，职责没错但位置不符合目标结构，
> 下一版迁到 `src/ui/`。

## 5. 关键数据结构

```ts
// 一个插件的中立描述：不含任何宿主字段
CanonicalPlugin {
  id, name, title, description, icon?
  authors: Author[]
  license?, homepage?, repository?, category?, keywords
  versions: PluginVersion[]        // 版本 + 安装来源 + 兼容性要求
  defaultVersion?
  resources: PluginResource[]      // command / tool / skill / model / prompt / config / file / ui-slot / transport
  provenance: 'vendor' | 'curated' | 'third-party' | 'local'
  discoveredVia?: HostAdapterId
}

// 兼容性要求的键统一加命名空间，避免跨宿主串台
RequirementKey = `${HostAdapterId}/${string}`      // 例：'dsh/engines.dsh'

// 资源：宿主相关的原始负载原样留在 payload，解析权归适配器
PluginResource<Payload> { kind: ResourceKind; id: string; title?; payload: Payload }

// 清单往来的中间层：核心能懂的一半 + 宿主专属的一半
ManifestView { id, version?, title?, …, requirements, hostFields: Record<string, unknown> }
```

## 6. 现有代码迁移改造点清单

已完成：

| 改造点 | 原位置 | 现在 |
|---|---|---|
| 包名 / 仓库 URL | package.json、index.json、docs | `plugbox` / `Wcof/PlugBox` |
| 挂载前缀与 RPC | `index.js`、`client.js`、vite | `/plugbox`、`/plugbox/api/rpc` |
| panel / 模块 / patch id | `cordis.patch.yml`、`client.js` | `plugbox` / `plugbox-plugin-center`，有断言保证一致 |
| 哪些 scope 算宿主干系 | `types/plugin.ts` 写死 `@deepseek-ai/` | `HostAdapter.vendorPackageScopes` |
| 收录来源判定 | `pluginService.ts` 写死 `labels.official` / `keywords.deepseekbox` | `core/protocol/catalog.ts` + 适配器 policy |
| 来源标签文案 | 多处写死 | `HostAdapter.labels` + `BRAND` |
| 兼容要求键 | 各处写死 `'engines.dsh'` | `hostRequirementOf()`，键带命名空间 |
| 版本比较 | `types/plugin.ts` 自带 | 迁到 `core/protocol/version.ts`，原地保留同名导出 |
| Toast / 错误文案里的宿主名 | store 8 处、组件若干 | `HOST.displayName` 模板 |
| 索引标题 / 标记词 | `pluginIndex.ts` | 取自 `BRAND` |
| 自条目身份 | `catalog.ts`、`sync-self-entry.mjs` | `plugbox`；脚本加了包名一致性断言 |
| 置顶判据 | `pinnedIndex.ts` 写死仓库名 | 从 `BRAND.repository` 解析，断言反向校验 |
| 文档文件名 | `DSH-PLUGIN-SPEC.md`、`article-dsh-*.md` | `docs/hosts/dsh-spec.md`、`article-engine-incompatible.md` |
| 脚本文件名 | `scan-dshhub.mjs` | `scan-community-hub.mjs` |

仍未做：

1. **UI 目录迁位**：`src/components` / `stores` / `services` → `src/ui/`（纯目录调整）。
2. **自有索引同宿主格式**：`index.json` 目前直接输出宿主索引格式；应先在核心定义中立目录，
   再由 index adapter 转格式，这样同一份目录能同时喂给多个宿主。
3. **`satisfies` 未实现**：DSH 适配器故意不实现区间判定（宿主要 semver 带 prerelease，
   重复实现只会得到两套打架的结论），目前以宿主下发的 `compatible` 为准。
4. `zcode-dsh` 的 4 项待核实：profile 名、UI 槽位、索引格式、自带包 scope；核实后改 `verified: true`。
5. 建议补一组「多宿主混合索引」夹具，覆盖跨宿主来源判定。

## 7. 验证

```
npm run build            # vue-tsc + vite；postbuild 串起下面五项
npm run check:all        # 组合包自检 / 两份索引 / 版本一致性 / 置顶判据 / 适配器约束
```

`check:adapters` 覆盖：方法映射无漏项、路由前缀不撞车、要求键带命名空间、manifest 往返不丢身份、
资源不谎报、未实测适配器不被默认选中、`index.js` 与 `cordis.patch.yml` 的常量与适配器一致。
