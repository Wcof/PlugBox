# PlugBox · 插件适配与管理工具

面向**所有支持自定义插件的引擎层与智能体层工具**的插件适配与管理工具：
里头是一个前台的插件中心，同时它自己也是一个可被宿主安装的插件包。
**架构分层（核心层 / 适配层）见 `ARCHITECTURE.md`，改结构前必读。**

## 核心目录与职责

- `index.js` —— 宿主进程半边（DSH 适配器的服务端实现）：`apply(ctx)` 用 `ctx.webServer.register({ kind: 'prefix' })` 把 `web/` 挂在 `/plugbox/`；同前缀下的 `/plugbox/api/rpc` 是 JSON-RPC 端点。路由前缀与 `src/adapters/dsh` 的 `routePrefix` 必须一致，`npm run check:adapters` 盯着。
- `client.js` —— 宿主浏览器半边：`window.__ModuleLoader__.load` 注册侧栏入口（`sidebar.panellist`）与主面板（`main`），面板内用同源 iframe 打开 `/plugbox/`。
- `cordis.patch.yml` —— 宿主组合包 patch，插入一行 `id: plugbox-plugin-center` / `name: plugbox`。这是宿主专属机制，不为别的目标宿主复用。
- `locale/` —— 插件管理器读取的双语展示元数据（`meta.title` / `meta.description`）。
- `web/` —— 插件前端的构建产物，随仓库提交（宿主从 git 安装时不执行构建，缺了会 503）。
- `src/types/plugin.ts` —— UI 侧的插件形态（版本比较已迁到 `src/core/protocol/version.ts`，此处保留同名导出）；宿主专属判断一律不许写在这里，写进来就违反了分层。
- `src/data/catalog.ts` —— 索引源（`index.json`）的收录库，按创作者划分；只服务对外发布的索引，不参与运行时。
- `src/data/pluginIndex.ts` —— 插件市场索引源生成器：从收录库生成宿主可读的插件索引（当前为 cordis 系 format 1，含 author / 双语 title / 项目图标 / 版本来源），供宿主「发现」页订阅；同文件还导出 `buildCommunityIndex()`，把社区目录体检结果生成第二份索引。
- `data/community/entries.json` —— 社区目录数据（从 dsh-plugin.org 同步，逐条做过仓库级核实），由 `scripts/scan-community-hub.mjs` 体检 + `scripts/build-community.mjs` 生成，只供 Node 侧生成索引用，不进前端包。
- `scripts/` —— `validate-index.mjs`（官方校验器验证索引，可传文件名）、`validate-bundle.mjs`（组合包自检）、`sync-self-entry.mjs`（postbuild 同步自身条目）、`scan-dshhub.mjs`（`npm run community:scan`，按仓库真实情况体检社区目录）、`build-community.mjs`（`npm run community:build`，生成 entries.json）、`dev-rpc-mock.ts`（仅 dev 的假宿主）。
- `icons/` —— 本仓库自有插件（插件中心）的图标文件，索引以绝对 raw URL 引用。
- `src/services/pluginService.ts` —— 真实内核接口层：端点 URL 由 `activeAdapter()` 经 `src/host/transport.ts` 求出，方法名与适配器声明一一对应；不做本地缓存。
- `src/stores/pluginCenter.ts` —— 插件中心唯一状态 owner（列表、搜索、筛选、busy、通知、确认弹窗），每次操作后回读宿主。
- `src/components/plugin/` —— 插件中心页面：`PluginCenter`（双 Tab + 工具栏 + 列表状态）、`LocalPluginCard`（组合包）、`StorePluginCard`（索引条目）、`PluginDetailPage`（包信息 + 逐行启停）、`PluginTile`。
- `src/components/ui/` —— 通用组件：通知条、确认弹窗、筛选下拉、安装对话框、开发指南弹窗（`DevGuideDialog.vue` + `markdown.ts`）。按分支安装是卡片内的下拉（`StorePluginCard`），不再单独开弹窗。
- 开发指南是面板内的弹窗，不跳任何外部站点：三个 Tab（插件开发指南 / 项目 README / 宿主契约）。`README.md` 与 `docs/hosts/dsh-spec.md` 用 `?raw` 在构建期打进前端产物，由 `markdown.ts` 的极简渲染器排版（标题、列表、表格、代码块、引用）；相对链接只显示文字，只有 http(s) 才生成可点链接。指南正文写在 `DevGuideDialog.vue` 的 `STEPS`，文档本体仍是仓库里的 md 文件，改完重新构建弹窗内容自动更新。
- `src/components/icons/` —— 图标常量。
- `src/styles/global.css` —— 设计令牌与全局样式（按钮、标签、卡片、弹窗、通知条）。

## 分层约定（核心层 / 适配层）

- `src/core/` —— **宿主无关**。统一的插件协议（`protocol/`）、清单双向转换（`manifest/`）、
  资源抽象与映射（`resources/`）、生命周期动词（`lifecycle/`）。这里一旦出现任何宿主的字段名、
  命令名、UML 槽位名，就是架构退化。
- `src/adapters/` —— **每个目标宿主一份**。`types.ts` 是契约（扩展点全在里面），`registry.ts` 管登记与
  当前宿主解析，`cordis.ts` 是 Cordis 协议族共用工厂，`dsh/` 与 `zcode-dsh/` 是两个内置适配器。
- `src/host/transport.ts` —— 运行时唯一的宿主读取入口，返回值必须是适配器对象。
- 外部只能 import `src/adapters/index.ts` 这个出口，不许深入某个具体宿主目录。
- 宿主的**机器契约**（`dsh.bundle`、`engines.dsh`、`dsh.meta`、组合包 patch）不是文案，删掉就装不进去：
  它们的正确归宿是适配器，而不是「随手写死的常量」。
- `verified: false` 的适配器一律不会被自动选中，且必须写明 `openQuestions`——这是为了让「未实测」
  三个字有实际约束力，而不是一句免责声明。

## 技术栈与命令

- Vue 3 `<script setup>` + TypeScript + Vite；不引入 UI 组件库与路由库，样式手写。
- `npm run dev`（端口 5180，`scripts/dev-rpc-mock.ts` 顶替宿主提供 `/api/rpc` 假数据）、`npm run build`（vue-tsc 类型检查 + 构建，postbuild 依次跑索引校验与组合包自检）、`npm run preview`。
- `npm run validate:bundle` 单独跑组合包自检；改动 `package.json` / `cordis.patch.yml` / `index.js` / `client.js` / `locale/` 后必跑。
- `npm run check:pinned` 单独跑精选置顶判据断言（8 条）；`npm run check:adapters` 单独跑适配器约束与宿主侧一致性；`npm run check:all` 一把跑齐 bundle / 两份索引 / 版本一致性 / 置顶判据 / 适配器约束。三项也都串在 postbuild 里，构建不通过就是没通过。

## 真实数据链路

- 页面只认 `pluginService`；它把每个动作翻译成 `POST /plugbox/api/rpc` 的 `{ method, params }`，**不保存任何本地插件状态**。
- Host 半边的方法表（`API_METHODS`）：`status`、`listBundles`、`listPlugins`、`setBundleEnabled`、`setPluginEnabled`、`removeBundle`、`installBundle`、`listIndexes`、`setIndexes`、`searchMarket`、`repoBranches`。
- 服务来源：`ctx.get('pluginManager')` 与 `ctx.get('pluginMarket')`，都是 DSH 自带的远程面实现；缺失时返回 503 `service-unavailable`，页面显示「当前 profile 没有装载插件管理服务」。
- `repoBranches` 是唯一一处不由 DSH 服务提供的方法：上游常把修复合在分支上却不发版，面板因此允许「按分支安装」。它先用 `git ls-remote --heads https://github.com/<owner>/<repo>` 列分支（GitHub REST 未登录只有 60 次/小时，容易限流；git 不受限也不用 token），git 不可用时才退回 REST；每个分支再从 `raw.githubusercontent.com/<repo>/<branch>/package.json` 读出版本号、`engines.dsh`、是否声明 `dsh.bundle`、以及 `dsh.meta.title` / 描述（不同分支的描述可能不一样，选之前要看得见）。结果按仓库缓存 60 秒。仓库名先过 `owner/name` 正则，git 用参数数组调用（不过 shell）。失败码：`invalid-params`、`repo-unavailable`、`github-rate-limited`、`github-unavailable`。
- 分支入口在卡片左下角的版本号上（不是弹窗）：点开是内联下拉，列分支、版本、要求范围、描述，逐行安装。安装分支走 `installBundle` 的 git spec（`git+https://github.com/<repo>#<分支>`），**不登记进索引**：索引只收录发布版本，分支是活口，随时会被上游重写。
- 检查更新的分支判定依据**持久化基线**（`localStorage` 键 `plugbox.branch-baselines.v1`，读写集中在 `src/stores/branchBaseline.ts`）：面板安装 / 更新成功后记录该仓库的分支快照；检查更新里零变更的仓库推进基线，有变更的保留——用户没处理的提醒不会在下次检查里凭空消失，直到通过面板处理。三类发现都算更新：所装分支头提交变化（head）、基线之后新出现的分支（new）、任一分支版本更高（version，含所装分支自身抬版本）。无基线的历史安装只报版本抬升，首次检查建立基线。纯判定在 `src/core/lifecycle/branch-diff.ts`（宿主无关、结构化类型，不许 import 适配层）；`compareVersions` 带 prerelease 语义（rc 低于同号正式版），装 rc 后上游发正式版必须报更新。
- 索引分两份：`index.json`（精选，人工收录）与 `community.json`（社区目录，从 dsh-plugin.org 同步）。社区条目只做**仓库级核实**——`git ls-remote` 能读到 HEAD、该提交的 package.json 声明 `dsh.bundle`、版本是 semver；字段一律取自仓库本身，不采信第三方目录的版本号。面板工具栏的「社区目录」按钮调 `setIndexes` 把 `community.json` 加进订阅，精选索引不掺沙子。
- 市场列表按 `storeRenderLimit`（默认 120）分批渲染，避免社区目录几千条一次塞进 DOM；搜索与筛选会重置上限。搜索结果仍然走宿主，能覆盖全部条目。
- 请求令牌：每次加载 / 搜索自带 `++state.storeRequest`，每个 await 之后都要 `isCurrent(token)`，过期即 return。取消路径按规定动作走——`cancelStoreSearch()` 作废在途请求**并替它补发一轮**（返回 true 表示已补发，调用方不要再自己 `loadStore`）；切 tab 只用 `clearStoreSearchTimers()`，不动在途请求。
- **作废在途加载必须补发**：被作废的那次会在每个 await 后发现自己过期并直接 return，绝不会再回头把 `storeStatus` 写成 `ready`；不补发列表就永远停在骨架屏，用户只能手动刷新。社区目录 5,413 条要翻 55 页，首次加载好几秒，这个窗口经常撞上。
- 两段式搜索：`scheduleStoreSearch` 防抖 260ms → `loadStoreSearch` 只取每个源的第 1 页先把首屏画出来；命中多于一页时延迟 `SEARCH_DEEP_DELAY=600ms` 再完整翻页补齐。已有列表时不换骨架屏，只在列表顶部显示细进度条（`state.storeProgress`），避免几千张卡塌陷、滚动位置丢失。清空搜索优先用 `fullMarket` 快照还原，不发新请求。
- 大索引取数：`fetchIndexPages` 首页同步取，其余页按 `MARKET_PAGE_CONCURRENCY=6` 并发拉取，页号保序拼回（并发不能打乱「索引顺序」）；`MARKET_MAX_PAGES=60`，社区目录 5,413 条可整份读入。分面：创作者只显示前 12 位（可展开到 48），分类单独一行且计数不受分类自身筛选影响——几千条时这两处是主要噪音源。
- 精选置顶：本仓库自带的 `index.json` 永远排第一组，且**不吃分批渲染的预算**（否则 5,413 条的社区目录会把它挤到看不见的位置）。判据是 `src/data/pinnedIndex.ts` 的纯函数 `isPinnedIndex`：末段是 `index.json`（剥掉 `?query` 与 `#hash` 后判断）+ 能解析出 owner/repo（认得 raw.githubusercontent.com 与 jsdelivr `/gh/`）+ 归属确是 `Wcof/PlugBox`。第三条是安全边界——第三方索引随便起个 index.json 就能置顶，等于把首屏位交给订阅源；`Wcof/DeepSeekBox-attacker` 必须判否。改判据先改 `scripts/check-pinned-index.mjs` 的 8 条断言。
- 空结果三态必须分开：`storeSearchEmpty`（搜不到）/ `storeIndexEmpty`（索引本身没条目）/ `noStoreMatch`（筛选组合为空）文案与操作各不相同，不能合并成一个「没有符合条件的插件」。
- 筛选摘要 `storeConditions` 由 state 直接算出，不依赖分面 chip 是否还在——chip 会随分面重算消失，条件跟着消失的话列表就空得没来由。来源那一档（official / catalog / third-party）为 0 且列表非空时标 warn，多半是提供它的索引源被移除了；`installed` / `available` 为 0 是常态，不报警。
- 安全：只接受 POST + 同源（`sec-fetch-site` 非 `cross-site`，`origin` 主机须与 `host` 一致），请求体上限 512 KiB。
- 配置项编辑不在远程面里（只有模型侧 `Config.listConfigs`），所以详情页只做包信息与逐行启停，不提供配置表单。

## 组合包约束

- `package.json` 必须声明 `dsh.bundle.patch`，否则 DSH 安装时报「这个包没有声明组合包，不能作为插件管理」；对外暴露 `exports` 的 `.`、`./client`、`./icon`、`./locale/*.json`。
- `files` 需覆盖运行时文件（`index.js`、`client.js`、`cordis.patch.yml`、`locale/*.json`、图标、`web`）；打包发布会按它过滤。
- Vite 构建 `base` 为 `./`、`outDir` 为 `web`：产物要能以宿主给的路由前缀挂载，绝对路径会 404。
- Client 半边不走构建：手写 `window.__ModuleLoader__.load`，React 来自浏览器模块表，禁止 require 任何 `@deepseek-ai/dsh-client-*` 包。

## 工程边界

- 业务数据一律经 `pluginService` 走宿主，UI 不直接改状态、不维护插件副本。
- 组合包状态（运行中 / 已停用 / 包不可用）与可用操作的映射只允许在卡片组件内实现，保持两 Tab 一致；`readOnlyReason` 非空的包禁止停用与卸载。
- 收录库只服务索引发布（分自荐收录 / 社区收录两区，按创作者划分；都是「本 Box 收录」，**不等于 DSH 官方**）：
  - `OFFICIAL_REGISTRY`（自荐收录）：首组为插件中心自身（创作者 Wcof / PlugBox，发布于本仓库），其后是作者自荐并经确认的插件（当前为乔木 / joeseesun 系列）；名称、别名、描述、版本、许可证需与插件仓库 README / Releases 一致。
  - `THIRD_PARTY_REGISTRY`（社区收录）：经核实的社区 DSH 插件，标准相同——仓库真实存在、确为 DSH 插件（`dsh plugin add` 可装 / 声明 dsh.bundle），版本与许可证核对自仓库 package.json / LICENSE；按创作者分组。
- 来源标签的三档语义（面板与索引必须一致）：`official` 只给 DSH 官方（索引 `metadata.labels` 含 `official`，本 Box 索引从不写）；`catalog` 表示收录在本 Box 索引里（关键词 `plugbox`）；其余索引源算 `third-party`。
- 索引 `pluginIndex.ts` 的登记要求：
  - `VERSION_SOURCES`：publishTimestamp（整数 Unix 秒，Releases published_at；未发版或版本超前取 package.json 变更提交时间）+ commit（40 位小写 SHA，Release tag 解包或变更提交）；缺失时构建报错。插件中心自身条目由 `scripts/sync-self-entry.mjs` 在每次构建后同步到当前 main 提交（始终比包含它的提交旧一个提交，属预期）。
  - `VERSION_SOURCES.enginesDsh`：必须原样镜像该 commit 上 package.json 的 `engines.dsh`（不加工范围），包没声明就省略该键。索引里**省略**表示「任意 DSH 版本」，写成 `{}` 等于向市场宣称无要求；而宿主装完仍会用 `semver.satisfies(运行时版本, engines.dsh, { includePrerelease: true })` 复核真实 package.json，漏登记的结果是市场照常显示「安装」、用户点下去才在安装阶段被拒并回滚。收录或升版时用 `curl https://raw.githubusercontent.com/<repo>/<commit>/package.json` 核对。**升版必须重抓**：不兼容标注只跟着登记的那个版本走，换了版本号却留着旧范围，标注会一直挂着（而且新版本来能装也装不上）。
  - `INDEX_ICONS`：icon 一律引用插件自己项目的图标文件（其仓库内 icon.svg / icon.jpg，URL 钉到收录版本提交并经 curl 核实 200）；项目未提供图标的用作者 GitHub 头像（`https://github.com/<user>.png`）。校验器允许 ≤32 KiB 的 data URI 或解析为 https 的 URL。
  - `author` 用 `authorLabel` 全称（如 `joeseesun（乔木）`），`title` 为双语展示名（`TITLE_EN` 登记 en 键）。
- 收录检索入口参考 awesome-dsh-plugin 清单与 GitHub topic（`deepseek-harness`、`dsh-plugin`）；非 DeepSeek Harness 宿主的插件（如 CLIProxyAPI 插件）不得收录。
- 未收录进两个登记区的插件归入「其他创作者」分组；新增创作者在对应登记区新增分组，不为单条插件改分组逻辑。
- 索引源：`/index.json` 由 `vite.config.ts` 的 `pluginIndexSource` 插件提供（dev 中间件 + build 产物），格式为 cordis 系宿主索引 `format: 1`；仓库根目录的 `index.json` 由 `npm run build` 的 postbuild 脚本从 `web/index.json` 同步生成，并立刻用官方校验器 `@deepseek-ai/dsh-plugin-market-index`（devDependency，`scripts/validate-index.mjs`，也可 `npm run validate:index` 单独运行）验证后提交，供 raw / jsDelivr 稳定引用，禁止手工编辑。只改 `src/data/pluginIndex.ts` 的映射逻辑来调整索引输出。`versions[].source.type` 只允许 `"npm" | "git"`：本 Box 收录的插件均为 git 来源，必须登记 `commit`（40 位小写 SHA，取 Release tag 解包或 package.json 变更提交）；`publishTimestamp` 为整数 Unix 秒。两者在 `VERSION_SOURCES` 登记缺失时构建直接报错。对外索引 URL：`https://cdn.jsdelivr.net/gh/Wcof/PlugBox@main/index.json` 与 `https://raw.githubusercontent.com/Wcof/DeepSeekBox/main/index.json`。

## 验证入口

- 改动后运行 `npm run build`；涉及 UI 视觉时启动 `npm run dev` 并核对两个 Tab、详情页、通知条、确认弹窗、安装对话框，以及卡片版本号下拉（展开、筛选内外、点击外部收起）。
- 涉及收录库或索引时：`npm run build` 后检查 `web/index.json`（11 个插件、format 1）与 `web/community.json`，并用 `npm run preview` 确认两份都可通过 HTTP 取到。收录或升版后跑 `npm run check:engines`：它按索引登记的 commit 拉真实 package.json 核对版本与 `engines.dsh`，并列出上游已有更新版本的插件，不一致时退出码为 1。刷新社区目录：`npm run community:scan`（约 20 分钟，5,700 个仓库）→ `npm run community:build` → `npm run build`。
- 索引发布走两个地址：`raw.githubusercontent.com`（即时生效）与 `cdn.jsdelivr.net/gh/Wcof/PlugBox@main/index.json`（缓存约 12 小时）。**每次推送后要 purge 一次** `curl https://purge.jsdelivr.net/gh/Wcof/PlugBox@main/index.json`，否则用 jsDelivr 订阅的人会长时间看到旧索引。
- 涉及组合包时：`npm run validate:bundle` 必须通过；再按 Host 路由自查项验证 `/plugbox/` 入口页 200、静态资源 200、`/plugbox` 308 补斜杠、路径穿越不返回 200、缺 `web/` 时 503 带修复提示。
- 涉及检查更新或版本比较时：`npm run check:updates` 必须通过（compareVersions 的 prerelease 语义 + 分支差分判定断言，覆盖「装分支后上游推新提交在重开面板后首次检查即报出」的原始漏检场景）。
- 涉及 API 时：用假 ctx 起本地 HTTP 覆盖 `listBundles` / `setBundleEnabled` / `installBundle` / `searchMarket` / `repoBranches` 的透传、跨站与异源拒绝、未知方法 400、非 POST 405；`repoBranches` 另外覆盖非法仓库名 400 `invalid-params`、不存在的仓库 `repo-unavailable`、以及重复调用命中缓存（第二次应明显快于第一次）。真实链路只能在 DSH 内验证（`ctx.get('pluginManager')` 存在与否）。
- 操作路径清单：检查更新 → 一键更新 / 单个更新、启用 / 停用组合包、卸载二次确认、商场安装与更新、按包名 / git / 本地目录安装、按分支安装（分支列表 → 挑分支 → 安装）、详情页逐行启停。

## 项目特有红线

- 不在 `data/catalog.ts` 中编造插件数据；版本、许可证等信息以插件仓库实际发布为准，无法核实处标记「待确认」。
- 界面参考图只约束视觉风格，不照搬图中的示例插件与示例操作。
- 官方索引校验器**不检查**「包是否声明了组合包」，索引通过不代表装得上；上架或升版前必须跑 `npm run validate:bundle`。
- `web/` 是随包提交的产物，改动前端后必须重新 `npm run build` 并连同源码一起提交，不允许只提交源码。
- 索引只登记发布版本（Release tag 或 package.json 变更提交）。上游把修复合在未合并分支上时，用「按分支安装」这条旁路，不把索引指向分支或 draft PR。
- 索引里不得出现 `official` 标记：`metadata.labels` / `keywords` 里的 `official` 表示 DSH 官方收录，本 Box 的索引一律用 `plugbox` 标记自己的收录。
- 页面里不允许再出现假数据；替身只允许存在于 `scripts/dev-rpc-mock.ts`（仅 dev server 生效，不进 `web/`），且新增字段必须与宿主真实返回结构一致。
- **核心层不许出现宿主专属概念**。需要引用宿主的东西（路由前缀、方法名、来源标记、兼容要求字段名、
  哪些 npm scope 算宿主干系、UI 槽位）一律从 `activeAdapter()` 取；本红线由 `npm run check:adapters` 部分自动把关。
- **新增宿主只加适配器**：给 `src/adapters/<id>/` 写一份 `HostAdapter`（同族复用 `cordis.ts` 的工厂）、
  在 `registry.ts` 登记、跑 `npm run check:adapters`。为了接一个新宿主改 `src/core/`，说明接口设计漏了。
- 品牌身份（产品名、包名、收录标记、索引文件名）只写在 `src/core/protocol/brand.ts` 一处；
  `scripts/sync-self-entry.mjs` 与 `scripts/check-pinned-index.mjs` 都会反向校验，改名漏改会直接构建失败。
