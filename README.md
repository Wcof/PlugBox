# PlugBox：插件适配与管理工具

**中文** | [English](README.en.md)

**PlugBox 是一个插件适配与管理工具**：面向所有支持自定义插件的引擎层与智能体层工具，在同一套界面里浏览、安装、更新、启用或停用插件。它不再绑定任何单一引擎——宿主之间的差异全部封装在适配器里，核心层只回答「插件是什么」。

它目前以 DeepSeek Harness 插件（组合包）的形式分发，并对外发布一份可被任意 DSH 实例订阅的插件索引。

| 项 | 值 |
|---|---|
| 产品名 | **PlugBox**（中文定位：插件适配与管理工具） |
| npm 包名 | `plugbox` |
| 组合包 patch 的 id / name | `plugbox` |
| 侧栏模块 id | `plugbox` |
| locale 命名空间 | `plugBox` |
| 图标 | `icons/plugbox.svg` |
| 宿主挂载前缀 | `/plugbox` |
| RPC 端点 | `/plugbox/api/rpc` |
| GitHub 仓库 | <https://github.com/Wcof/PlugBox> |
| 介绍页 | <https://wcof.github.io/PlugBox/> |
| 许可证 | MIT |

最短安装路径：在 DeepSeek Harness 的「发现 → Index sources」里加上 `https://raw.githubusercontent.com/Wcof/PlugBox/main/index.json`，搜索 `plugbox` 安装，重启窗口；或在命令行执行 `dsh plugin --profile web add github:Wcof/PlugBox`。

如果你在找「某某引擎的插件在哪里装」「有没有一个能统一管理插件的市场」，这个项目提供的就是那层界面。插件列表来自宿主真实的 `pluginManager` / `pluginMarket` 服务，不维护第二份数据。

---

## 为什么分层

插件生态的真正差异不在「装不装得上」，而在每个宿主怎么描述自己：清单字段叫什么、插件怎么注册 UI、RPC 方法叫什么名字、插件交付的能力落成什么结构。把这些塞进一套逻辑里，接第二个宿主时就会到处是 `if`。

PlugBox 因此分成两层：

### 核心层 `src/core/`（与任何引擎无关）

统一的插件协议、清单解析与生成、注册与发现、生命周期管理，以及插件资源的抽象。

| 位置 | 职责 |
|---|---|
| `protocol/plugin.ts` | 宿主无关的插件协议：`CanonicalPlugin`、`PluginVersion`、`Requirements`、`ResourceKind`、`PluginResource`、`Provenance` |
| `protocol/catalog.ts` | 索引条目结构与出处判定；标记的名字由适配器声明，核心只负责按规则算 |
| `protocol/version.ts` | 版本比较 |
| `protocol/brand.ts` | 产品自身的身份常量（品牌名、包名、标记词、索引文件名） |
| `manifest/index.ts` | 清单双向转换：`readManifest` / `toCanonical` / `writeManifest` / `toInstallSpec` |
| `resources/index.ts` | 插件资源（模型 / 工具 / 配置 / 文件 / UI 槽位）的统一抽象 |

核心刻意不认识任何具体宿主的字段名。兼容要求一律写成带命名空间的 `requirements['<宿主id>/<要求名>']`，例如 `'dsh/dsh'`；资源最终落到宿主的哪个位置由适配器决定。

### 适配层 `src/adapters/`（每个目标宿主一个适配器）

一句话：**适配器回答「这个宿主怎么说话」，核心回答「插件是什么」。**

`src/adapters/types.ts` 定义 `HostAdapter` 契约，一个适配器要交代：

| 契约 | 内容 |
|---|---|
| `ui` | 挂载前缀、RPC 路径、模块 id、locale 命名空间、占用的 UI 槽位 |
| `labels` | 来源标签三档的展示名（官方那一档写宿主自己的名字，从适配器取） |
| `catalog` | 索引格式、出处判定策略、本产品在该宿主索引里的来源标记词 |
| `manifest` | 清单双向转换（`extract` / `compose` / `requirementKeyOf`），以及可选的版本判定 `satisfies` 与准入校验 `pluginGate` |
| `resources` | canonical 资源 → 宿主申领；返回 `null` 表示该宿主接不住这类资源 |
| `methods` | canonical 动词 → 宿主真实调用名 |
| `installSpec` | canonical 描述 → 宿主安装参数 |

**新增一个宿主 = 加一个实现了 `HostAdapter` 的目录 + 在 registry 里登记，核心一行都不用改。** 反过来说，如果为了接一个新宿主改了 `src/core/`，那是设计出了问题。

### 宿主专属术语：保留，但要标注归属

下面这些都是 **DeepSeek Harness 自己的协议字段、文件格式与命令**，由 DSH 适配器提供，是让插件真能装进 DSH 的必要信息——**它们不是产品文案，不能被「中立化」改写**：

`dsh.bundle`（组合包声明）· `engines.dsh`（兼容范围）· `cordis.patch.yml`（组合包 patch）· `dsh plugin add`（安装命令）· `pluginManager` / `pluginMarket`（宿主服务）

完整契约见 [docs/hosts/dsh-spec.md](docs/hosts/dsh-spec.md)。这份文档属于 DSH 适配器，**不属于核心层**：换一个宿主就有另一份契约。

---

## 支持矩阵

| 宿主 | 适配器 id | 宿主协议 / 命令 | 是否实测 | 说明 |
|---|---|---|---|---|
| DeepSeek Harness（DSH） | `dsh` | `dsh.bundle` · `cordis.patch.yml` · `engines.dsh` · `dsh plugin add` | **已实测**（`0.2.1-rc.5`） | 第一个支持的宿主，也是当前唯一在真实宿主上跑通过的适配器；契约见 [docs/hosts/dsh-spec.md](docs/hosts/dsh-spec.md) |
| zcode 的 DeepSeek Harness | `zcode-dsh` | 与 DSH 同协议族 | **未实测** | 已知宿主，尚未在真实环境验证；其 CLI 入口、profile 布局与 UI 槽位的差异待补充，在此之前不得声称已支持 |

> 表中没有出现的宿主，即表示尚未对接。**DSM Harness 除外：本项目没有对应的适配器，不要按它的存在推断支持面。**
> 未实测的适配器在契约里标记 `verified: false`，不会作为默认选择；有未决问题的适配器还会带上 `openQuestions`。

---

## 安装

PlugBox 目前以 DeepSeek Harness 组合包的形式分发——`package.json` 里的 `dsh.bundle.patch` 是 DSH 的协议字段，由 DSH 适配器提供。三种装法任选；换到别的宿主后，安装参数由该宿主的 `HostAdapter.installSpec` 决定。

### 方式一：从索引源安装（推荐）

1. 打开 DeepSeek Harness 的「发现」页，在 Index sources（索引源）里添加：
   `https://raw.githubusercontent.com/Wcof/PlugBox/main/index.json`
2. 搜索 `plugbox`，点安装。
3. 重启 DSH 窗口（Host 端代码在启动时加载）。

### 方式二：从 GitHub 安装

在面板的「安装插件」对话框里填入下面任一形式：

- `github:Wcof/PlugBox`
- `git+https://github.com/Wcof/PlugBox#<commit-sha>`（钉到某个提交，适合复现问题）

或在命令行执行（`--profile` 换成你实际的 profile 名，桌面端通常是 `desktop`）：

```bash
dsh plugin --profile web add github:Wcof/PlugBox
```

### 方式三：本地目录安装（开发用）

在「安装插件」里填本仓库的绝对路径，例如 `/Users/you/code/PlugBox`。改完前端记得 `npm run build` 并提交 `web/`——从 git 安装不会执行构建。

---

## 使用

### 插件管理

顶部是来源统计卡，点卡片即筛选。每张卡片显示标题、包名、来源、运行状态和插件行数；点「详情」进入逐行启停页。

### 插件市场

按索引源分组显示条目，卡片上标来源、状态（可安装 / 已安装 / 可更新 / 版本不符）和当前版本。工具栏支持搜索、来源 chips、创作者多选和多种排序；索引超过 100 条时按 `nextOffset` 续页，超上限会在列表上方如实提示「索引共 N 个，已加载 M 个」。

来源标签由当前适配器提供（见下表），因此不同宿主下「官方」那一档显示的文字不同——在 DSH 里显示为「DSH 官方」。

### 按分支安装

点卡片左下角的版本号，弹出该仓库的分支列表：

- 每个分支显示名称、包内版本号、该宿主要求的兼容范围，以及分支自己的标题与描述（不同分支的描述可能不一样）；
- 没声明对应宿主插件字段的分支（在 DSH 上是 `dsh.bundle`）禁用安装；
- 已装的版本会标「当前已装」，此时换分支需要先卸载。

装的是**分支当前的头提交**：上游后续推送会改变它。要固定版本，还是等上游发 tag 后走正常安装。

分支列表由 Host 半边用 `git ls-remote --heads` 读取（不消耗 GitHub API 配额），失败才退回 GitHub REST。

### 检查更新

页面打开时会静默比对索引与已装版本，有可更新就在顶部提示；点「检查更新」可强制刷新索引缓存。

---

## 来源标签

三种标签含义不同：

| 标签 | 含义 | 判定方式 |
|---|---|---|
| **宿主官方** | 当前宿主官方维护或官方收录。展示名由适配器提供（DSH 下为「DSH 官方」） | 适配器声明的 `vendorLabels` 命中（DSH 为条目 `metadata.labels` 含 `official`） |
| **PlugBox 收录** | 收录在本仓库维护的索引里 | 索引条目 `metadata.keywords` 含 `plugbox` |
| **第三方** | 来自其他订阅的索引源 | 以上都不满足 |

判定函数 `provenanceOf(entry, policy)` 在核心层，规则 `ProvenancePolicy` 由适配器声明——核心不认识任何宿主的字段名，所以新增一个「官方用 `keywords.vendor` 表示」的宿主时，只加适配器即可。

**「PlugBox 收录」是本站的整理，不代表任何宿主官方背书。** 收录标准：仓库真实存在、确为目标宿主的插件（在 DSH 上表现为声明 `dsh.bundle`、可被 `dsh plugin add` 安装）、版本与许可证可核对（仓库 `package.json` / `LICENSE`）、插件版本已发布或至少对应一个确定的提交。当前收录 11 个插件，覆盖阅读、学习、效率、界面增强、工具、模型六个分类。

想推荐插件：在本仓库开 issue，附仓库地址、目标版本号与许可证；核对通过后由维护者加入收录库。

---

## 索引源与两份索引

### 精选索引 `index.json`

人工精选的收录库，随仓库发布，格式为 DSH 插件索引 `format: 1`，可被任何 DSH 实例订阅。三个入口：

| 入口 | 地址 | 说明 |
|---|---|---|
| GitHub Raw | `https://raw.githubusercontent.com/Wcof/PlugBox/main/index.json` | 始终最新，推荐 |
| jsDelivr | `https://cdn.jsdelivr.net/gh/Wcof/PlugBox@main/index.json` | CDN 镜像，缓存约 12 小时 |
| 仓库内文件 | 仓库根目录下的 `index.json` | 随仓库一起签出，构建时生成 |

索引由 `src/data/catalog.ts`（收录库）+ `src/data/pluginIndex.ts`（生成器）产出，`npm run build` 后同步到根目录 `index.json`，并用 DSH 生态的官方校验器 `@deepseek-ai/dsh-plugin-market-index` 验证。

每个版本的 `source` 为 `{ type: "git", url, commit }`；`engines.dsh` 原样镜像该提交的 `package.json`——索引里省略表示「任意 DSH 版本」，所以不能想当然地留空。

jsDelivr 长时间不更新时手动刷新：

```bash
curl https://purge.jsdelivr.net/gh/Wcof/PlugBox@main/index.json
```

### 社区目录 `community.json`

精选索引只有十几条，翻不到想要的那个。仓库因此另外发布一份**社区目录**：从第三方站点 [dsh-plugin.org](https://dsh-plugin.org) 同步的社区插件，逐条做过仓库级核实——仓库可达、该提交的 `package.json` 声明了宿主要求的插件字段、版本号取自包本身。条目统一带 `community` 标记词，用于和精选条目区分。

- `https://raw.githubusercontent.com/Wcof/PlugBox/main/community.json`

订阅方式二选一：在 DSH「发现 → Index sources」里加上面这条地址；或在面板的工具栏点「社区目录」一键订阅。条目较多（数千条），搜索比逐页翻更高效；列表按批渲染，点「显示更多」继续加载。

社区目录里的条目只代表「这个仓库确实是一个目标宿主的插件包」，不代表我们验证过它的行为或兼容性；能否安装仍以宿主按 `engines.dsh` 的判断为准。

---

## 给插件作者：清单与资源映射

核心层做清单转换时**刻意经过一层「中间视图」**：宿主的插件资格字段（例如 DSH 要求 `package.json` 里声明 `dsh.bundle.patch`）是宿主专属的，直接塞进 canonical 会把核心污染回去；完全丢掉又会让插件在目标宿主上装不起来。

```
宿主 package.json ──adapter.manifest.extract──▶ 中间视图 ManifestView（宿主专属字段原样保留在 hostFields）
中间视图 ──toCanonical──▶ CanonicalPlugin（纯中立描述）
CanonicalPlugin + 资源 ──writeManifest──▶ 目标宿主的 package.json 片段
```

对插件作者来说，只有三件事值得注意：

1. **兼容范围写成区间，不要枚举预发布版本。** `>=0.2.1-rc.2 <0.3.0-0` 一次覆盖整个 0.2.1 系列，不用每个 rc 都改；写成 `0.2.1-rc.2 || 0.2.1-rc.3` 会在下一个 rc 发布当天失效。完整排查见 [docs/article-engine-incompatible.md](docs/article-engine-incompatible.md)。
2. **兼容字段是宿主的，键会被加命名空间。** 核心统一存 `requirements['<宿主id>/<要求名>']`，由 `requirementKeyOf` 映射（DSH 的 `engines.dsh` → `dsh/dsh`），写回时再剥掉。别在核心层期待看到原始字段名。
3. **资源按种类声明。** 统一的资源种类为 `command` / `tool` / `skill` / `model` / `prompt` / `config` / `file` / `ui-slot` / `transport`。同一份资源在不同宿主里落成不同结构（UI 槽位在 DSH 里是 `sidebar.panellist` + `main`），这份差异由 `HostAdapter.resources.map` 负责；接不住的资源会返回 `null` 而不是假装兼容。

---

## 兼容性与边界

- 验收环境：DeepSeek Harness `0.2.1-rc.5`（npm `latest`）。宿主升级后建议重跑 `npm run check:engines` 核对索引。
- 兼容判定在宿主侧：`engines.dsh` 存在时只按它判断（忽略 peerDependencies），规则是 `semver.satisfies(运行时版本, range, { includePrerelease: true })`。这条规则属于 DSH 生态，由 DSH 适配器的 `satisfies` 实现；适配器不实现时核心只返回 `unknown`，不猜。
- 分支安装只展示分支声明的兼容范围，面板无法预判是否兼容（运行时版本没有暴露给页面），真正的判定发生在安装时。
- 索引每个插件只登记一个已发布版本；要装其他版本走分支安装，或等索引升版。
- 不提供插件配置界面：DSH 的远程面只暴露组合包与插件行的启停、安装、卸载，配置 schema 在模型侧（`Config.listConfigs`）。
- 未实测的适配器不会被选为默认宿主适配器。

---

## 常见问题

**PlugBox 和宿主自带的「发现」页有什么区别？**
两者读同一套宿主服务。自带的「发现」页一次浏览一个索引；PlugBox 聚合多个索引源，额外提供作者分面、兼容性标记与按分支安装。

**PlugBox 支持哪些宿主？**
见上方支持矩阵。目前只有 DeepSeek Harness 在真实宿主上跑通过；zcode 的 DeepSeek Harness 是已知宿主但尚未实测。新增一个宿主 = 新增一个适配器 + 少量配置，不需要改核心。

**「PlugBox 收录」是宿主官方收录吗？**
不是。它只表示该插件被本仓库维护的索引收录。宿主官方收录按各宿主自己的标记判定（DSH 是条目 `labels` 里的 `official`），两者在界面上用不同标签区分。

**为什么某个插件显示「版本不符」？**
该版本声明的兼容范围（`engines.dsh`）不包含你当前的 DSH 版本。卡片上会写出它要求的范围，升级 DSH 或等插件放宽声明后才能装。完整排查见 [docs/article-engine-incompatible.md](docs/article-engine-incompatible.md)。

**按分支安装和正常安装有什么不同？**
正常安装装的是索引登记的固定提交；分支安装装的是分支当前的头提交，会随上游推送变化，适合上游还没发版的修复。

**为什么装完要重启？**
插件的 Host 端代码在 DSH 启动时加载，前端资源可以热更，Host 代码不能。

**索引源加了但看不到插件？**
先确认 URL 可访问（浏览器打开应返回 JSON），再在面板点「检查更新」刷新缓存；jsDelivr 有约 12 小时缓存，必要时用上面的 purge 命令。

**旧的 DeepSeekBox 订阅地址还能用吗？**
不能。仓库已改名为 **Wcof/PlugBox**，旧的 `Wcof/DeepSeekBox` 索引地址已失效。请在「Index sources」里删除旧地址，改订阅 `https://raw.githubusercontent.com/Wcof/PlugBox/main/index.json`（或对应的 jsDelivr 地址）；已安装的旧版本可以用方式二重新从新地址安装覆盖。

---

## 开发

```bash
npm install
npm run dev              # 开发服务器 http://localhost:5180，自带假宿主 mock
npm run build            # 类型检查 + 构建到 web/，自动跑 postbuild（索引同步与各项校验）
npm run preview          # 预览构建产物
npm run check:all        # 组合包自检 + 索引校验 + engines 巡检 + 固定索引检查
npm run validate:bundle  # 单独跑组合包自检
npm run check:engines    # 核对索引登记的兼容范围与上游 package.json 是否一致
npm run check:pinned     # 核对固定索引
npm run community:scan   # 扫描社区插件源（--all 全量）
npm run community:build  # 由扫描结果生成社区目录
```

技术栈：Vue 3 `<script setup>` + TypeScript + Vite，不引入 UI 组件库与路由库，样式手写。`web/` 是随仓库提交的构建产物——DSH 从 git 安装时不执行构建，缺了会 503。

### 目录结构

```
index.js              Host 半边：/plugbox/ 静态路由 + /plugbox/api/rpc
client.js             Client 半边：侧栏入口 + 主面板 iframe
cordis.patch.yml      组合包 patch（DSH 协议），插入面板这一行
icons/plugbox.svg     宿主侧栏图标
locale/{zh,en}.json   面板显示的多语言文案（命名空间 plugBox）
src/core/             核心层：插件协议、清单转换、资源管理（与宿主无关）
src/adapters/         适配层：每个目标宿主一个 HostAdapter
src/services/         通往宿主 RPC 的唯一出口
src/components/       面板 UI
src/data/             收录库与索引生成器
web/                  前端构建产物（随仓库提交）
scripts/              索引与组合包校验、社区目录同步、engines 巡检、dev 假宿主
docs/                 介绍页与宿主文档
index.json            对外发布的精选索引（构建时生成）
community.json        对外发布的社区目录（构建时生成）
```

### 数据流

页面只认 `src/services/pluginService.ts`，它把每个动作翻译成 canonical 动词（`status`、`listBundles`、`listPlugins`、`setBundleEnabled`、`setPluginEnabled`、`removeBundle`、`installBundle`、`listIndexes`、`setIndexes`、`searchMarket`、`repoBranches`），再发往 `POST /plugbox/api/rpc` 的 `{ method, params }`；Host 半边按当前适配器的 `methods` 映射表转成宿主真实调用名，交给 DSH 的 `pluginManager` / `pluginMarket`。`repoBranches` 是唯一不由宿主服务提供的方法，用于读仓库分支。

接口只接受 POST + 同源请求，请求体上限 512 KiB；安装与卸载会跑 pnpm，可能持续数分钟。

---

## 相关文档

- [AGENTS.md](AGENTS.md)：工程结构、职责边界、红线与验证入口
- [ROADMAP.md](ROADMAP.md)：当前进度与历史记录
- [docs/hosts/dsh-spec.md](docs/hosts/dsh-spec.md)：DeepSeek Harness 的宿主契约（DSH 适配器）
- [docs/article-engine-incompatible.md](docs/article-engine-incompatible.md)：插件「版本不符」的排查长文
- [goals/](goals/)：施工记录
- [docs/index.html](docs/index.html)：GitHub Pages 介绍页（含 SoftwareApplication / FAQPage 结构化数据）

## English

**PlugBox is a plugin adapter and management tool for engines and agent platforms that support custom plugins.** Manage plugins in one panel while host differences stay inside adapters: browse, install, update, enable and disable plugins, aggregate multiple index sources, surface versions the running host cannot load, and install straight from a git branch when upstream has not published a release. DeepSeek Harness is the first supported host. The project is itself an installable bundle and publishes a plugin index that DSH instances can subscribe to:

`https://raw.githubusercontent.com/Wcof/PlugBox/main/index.json`

Keywords: plugin adapter, plugin manager, plugin market, plugin index, branch install. License: MIT.

## 致谢与免责声明

致谢：宿主 DeepSeek Harness 提供的插件机制，社区站点 [dsh-plugin.org](https://dsh-plugin.org) 的目录数据，以及 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 等社区清单。

免责声明：

- **本项目与 DeepSeek 官方、zcode 均无隶属关系**，也不是任何宿主的官方产品。
- 「PlugBox 收录」是本项目的整理，不代表任何宿主官方背书；社区目录条目来自第三方站点的同步，只保证仓库级核实（仓库可达、确为插件包、版本取自包本身），不保证其行为或兼容性。
- 其他插件市场实现各自维护自己的目录；PlugBox 不替代它们，只是把索引源合并进一个面板，并额外提供兼容性标记与按分支安装。

## 许可证

MIT，见 [LICENSE](LICENSE)。
