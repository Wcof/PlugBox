# Goal：修复检查更新漏检——覆盖已发布版本与分支新增内容两类场景

- 创建时间：2026-11-14 13:30（北京时间）
- 状态：已完成（2026-11-14 13:44；真实 DSH 宿主内的端到端待装机实测，已在 ROADMAP 记明）

## 目标

修复插件中心「检查更新」的漏检缺陷：对所有已安装插件准确执行更新判断，同时覆盖两类场景——
① 已发布的最新版本更新；② 当前所用版本或分支之后新创建、且发布时间晚于当前版本或分支的
新版本或分支。重点解决后一类（装分支后上游推新提交、上游新建分支）在首次检查时检测不到的问题，
做到不漏报也不误报。

## 根因（已核实）

检查更新主链路在 `src/stores/pluginCenter.ts`：

1. **分支基线只存内存**（`knownBranchSnapshots`，会话级 Map）：面板重开或宿主重启后首次
   「检查更新」没有基线，`isNew` / `headChanged` 永远为 false——装分支（如 `wcot/dsh-files#main`
   装在 v0.2.2 头提交）后上游推送新提交，只要没发更高版本就完全检测不到。
2. **`newer` 排除了所装分支自身**（`branch.name !== installedRef`）：所装分支版本号被上游抬升
   （0.2.2 → 0.2.3）也只能靠 `headChanged`（依赖基线）兜住，首次检查同样漏报。
3. **`compareVersions` 不识别 prerelease**：已装 `0.2.2-rc.1` 与已发布 `0.2.2` 被判等，
   发布时间更晚的正式版漏报（`parseInt` 把 `2-rc.1` 截成 2）。

## 修复方案

1. **持久化分支基线**（`src/stores/branchBaseline.ts`，localStorage + 内存兜底）：
   记录每个仓库的分支名集合与各分支头提交 SHA。
   - 写入时机：本面板任何 `installBundle` 成功后（安装 / 更新 / 按分支安装）记录一次快照；
     「检查更新」里**零变更**的仓库推进基线（变更窗口滚动）；有变更的仓库保留旧基线，
     提醒持续可见直到用户通过面板安装/更新（此时基线刷新）——不漏报也不反复。
2. **纯函数分支差分**（`src/core/lifecycle/branch-diff.ts`，宿主无关、结构化类型）：
   `diffBranches({ baseline, branches, installedRef, installedVersion })` 输出 findings——
   - 基线存在：新出现的分支 → `new`；所装分支头提交变化 → `head`；任一分支版本更高 → `version`
     （**不再排除所装分支**，版本号抬升本身就是更新）。
   - 基线不存在（历史安装）：仅报 `version`，其余诚实不报，首次检查建立基线。
3. **prerelease 感知的版本比较**（`src/core/protocol/version.ts`）：semver 优先级规则
   （无 prerelease > 有 prerelease；数字标识符按数值、字母按字典序、数字 < 字母；忽略 build 元数据）。
   纯数字版本行为与现状完全一致，不影响其他调用方（manifest 排序同步受益）。
4. **覆盖完整性**：分支仓库解析链补齐（索引条目 → 安装来源 git spec）；读失败的仓库只跳过自身、
   保留旧基线；`readMarketForUpdateCheck` 已有的全量快照与失败告警保持不变。

## 边界

- 不改宿主 `index.js` 的 `repoBranches` 返回结构（不加提交日期——需逐分支 REST 调用，易限流；
  基线对比用头提交 SHA 足以判定「上游变了」）。
- 不改 UI：`BranchUpdate` 结构与 reason 语义不变，现有分支提醒展示直接复用。
- `localStorage` 仅存分支基线缓存（UI 侧元数据），插件事实状态仍在宿主；存取失败静默降级为内存。
- 不做：历史安装（无基线）且未发版的头提交变化检测——无锚点时无法诚实判定，首次检查建立基线后
  即可覆盖，如实记录为已知边界。

## 测试与验证

1. `scripts/check-update-detection.mjs`（新增，esbuild 打包 TS 入口，模式同 check-adapters.mjs）断言：
   - compareVersions：rc < 正式版、alpha.2 < alpha.10、无 prerelease 高于有 prerelease、
     build 元数据忽略、纯数字版本行为不变。
   - diffBranches：无基线只报 version；持久基线下「上游推送同分支」首次检查即报 head；
     新建分支报 new；所装分支版本抬升报 version；旧分支低版本不报；无 bundle 声明的分支跳过；
     基线 head 缺失不断言 head。
2. `npm run build`（postbuild 串官方索引校验 + 组合包自检 + 既有 check 脚本）零失败。
3. `npm run check:all` 通过。
4. dev 链路冒烟：`npm run dev` 页面正常加载，检查更新按钮可用（假宿主数据下结果与 mock 一致）。

## 验收标准

- 上述 1–3 全部通过；`scripts/check-update-detection.mjs` 覆盖「装分支后上游推新提交（版本不变
  与版本抬升两种）在重开面板后首次检查即被报告」这一原始缺陷场景。
- 不误报：基线中已存在的分支、未抬版本的旧分支、无 bundle 声明的分支不产生更新项。
- AGENTS.md / ROADMAP.md / 本文档按规范更新；`web/` 产物随源码一同重建。

## 交付结果

- `src/core/protocol/version.ts`、`src/core/lifecycle/branch-diff.ts`、`src/stores/branchBaseline.ts`、
  `src/stores/pluginCenter.ts`、`scripts/check-update-detection{,.mjs}`、`package.json` 的修复与登记。
- 更新后的 goals 文档（本文件）、AGENTS.md、ROADMAP.md，`web/` 构建产物。
- 验证记录写入 ROADMAP.md「最近验证」。
