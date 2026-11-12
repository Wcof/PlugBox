<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { pluginCenter } from '../../stores/pluginCenter'
import { HOST } from '../../types/plugin'
import { renderInline, renderMarkdown } from './markdown'
// 两份文档是构建期打进产物的本地内容，不联网、不依赖宿主额外提供静态文件
import readmeSource from '../../../README.md?raw'
import specSource from '../../../docs/hosts/dsh-spec.md?raw'

const { state, closeDevGuide } = pluginCenter

type TabKey = 'guide' | 'readme' | 'spec'
const tab = ref<TabKey>('guide')
const body = ref<HTMLElement | null>(null)

const TABS: ReadonlyArray<{ key: TabKey; label: string; hint: string }> = [
  { key: 'guide', label: '插件开发指南', hint: `从零写一个 ${HOST.displayName} 组合包` },
  { key: 'readme', label: '项目 README', hint: 'PlugBox 自身的定位、结构与命令' },
  { key: 'spec', label: '宿主契约', hint: '字段表、槽位、索引硬规则与红线' },
]

const readmeHtml = computed(() => renderMarkdown(readmeSource))
const specHtml = computed(() => renderMarkdown(specSource))

interface GuideStep {
  title: string
  body?: string
  code?: string
  bullets?: string[]
  note?: string
}

/**
 * 正文只写本仓库宿主契约里已验证的部分（docs/hosts/dsh-spec.md），
 * 未验证的 API 不列进来，免得照着做装不上。
 */
const STEPS: readonly GuideStep[] = [
  {
    title: '先分清三层，别把它们当成一个东西',
    body: '一个 DSH 插件会同时出现三种「东西」，层级不同：',
    bullets: [
      '**组合包 bundle** —— 一个声明了 `dsh.bundle.patch` 的 npm 包，安装时装的就是它。',
      '**插件行 entry** —— `cordis.patch.yml` 里的一条 `insert`，运行时启停的是它。',
      '**索引条目 plugin** —— `index.json` 里的一条可安装记录，只有想让别人在市场里发现时才需要。',
    ],
    note: '一个 bundle 可以有多条 entry，一条索引条目指向 bundle 的某个确定版本。只给自己用、能被 `dsh plugin add` 装上前四步就够了。',
  },
  {
    title: '最小文件集',
    code: `your-plugin/
├── package.json          # 身份 + dsh.bundle 声明 + exports
├── cordis.patch.yml      # 插入插件行
├── index.js              # Host 半边：导出 apply(ctx)
├── client.js             # 有 UI 才需要，手写，不参与构建
├── icon.svg
├── locale/{en,zh}.json   # 插件管理器读的双语元数据
└── web/index.html        # 自有 SPA 形态时的构建产物`,
    note: '**`web/` 必须提交进仓库**：DSH 从 git 安装时不执行构建，缺了页面直接 503。有 UI 就用同源 iframe 打开 Host 半边挂的静态页，不要既挂自有 SPA 又直挂 React 面板。',
  },
  {
    title: 'package.json 契约',
    body: '缺一个机器契约字段，宿主就装不进去——这些不是文案：',
    code: `{
  "name": "your-plugin",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "dsh": "0.2.1-rc.5" },
  "icon": "./icon.svg",
  "exports": {
    ".": "./index.js",
    "./client": "./client.js",
    "./icon": "./icon.svg",
    "./locale/*.json": "./locale/*.json",
    "./package.json": "./package.json"
  },
  "files": ["index.js", "client.js", "cordis.patch.yml",
            "locale/*.json", "icon.svg", "web"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "immediately": true }
  }
}`,
    bullets: [
      '**缺 `dsh.bundle.patch`** → 报「这个包没有声明组合包，不能作为插件管理」。',
      '**`files` 漏文件** → npm 发布 / pnpm 的 git 安装都会按它过滤，装完缺文件。',
      '**`engines.dsh` 写区间**，例如 `>=0.2.1-rc.2 <0.3.0-0`；枚举 `rc.2 || rc.3` 会在下个 rc 发布当天失效。省略表示任意 DSH 版本。',
      '声明了 `dsh.client` 就必须有 `exports["./client"]`；`platform` 必须是 `"web"`。',
    ],
  },
  {
    title: '组合包 patch 与两个半边',
    code: `# cordis.patch.yml
- insert:
    - id: your-plugin-panel
      name: 'your-plugin'`,
    bullets: [
      '**Host 半边 `index.js`**：ESM，导出 `apply(ctx)`；只做注册，副作用包在 `ctx.effect(..., label)` 里好让卸载时清理；依赖服务用 `ctx.inject([\'webServer\'], ...)`。',
      '**Client 半边 `client.js`**：手写 `window.__ModuleLoader__.load`，React 从浏览器模块表 `require(\'react\')` 取；**禁止 require `@deepseek-ai/dsh-client-*`**。',
      '已验证的 UI 槽位只有 `sidebar.panellist` 与 `main`；其他槽位不要臆造。',
      '挂 HTTP 前缀路由用 `ctx.webServer.register({ kind: \'prefix\', path, handler })`；写接口只接受 POST + 同源，静态文件做路径穿越防护。',
    ],
    note: 'patch 里的 `id` / `name` 要和 Client 半边注册的模块 id 对齐，否则面板挂不上。',
  },
  {
    title: '本地调试与构建',
    code: `npm install
npm run dev              # 5180，自带假宿主 /api/rpc
npm run build            # 类型检查 + 构建到 web/ + postbuild 校验
npm run validate:bundle  # 组合包自检：package.json / patch / exports / files
npm run check:all        # 索引、engines 巡检、置顶判据、适配器约束`,
    bullets: [
      'Vite 的 `base` 必须是 `./`、`outDir` 是 `web`：产物挂在宿主给的前缀下，绝对路径会 404。',
      '请求体设上限（本项目 512 KiB）；`web/index.html` 缺失时返回 503 + 可执行的修复提示，不要留白页。',
      '安装 / 卸载会跑 pnpm、可能持续数分钟，长任务要摘掉连接空闲超时 `req.setTimeout(0)`。',
    ],
  },
  {
    title: '装到自己的 DSH 并验证',
    code: `dsh plugin --profile web add github:you/your-plugin
# 上游修复还没发版时，按分支装当前头提交：
dsh plugin --profile web add 'git+https://github.com/you/your-plugin#fix-branch'`,
    note: '装完要**重启窗口**：Host 端代码在 DSH 启动时加载，前端资源可以热更，Host 代码不行。装好后在插件中心点「检查更新」，索引里的新版本与仓库里的新分支都会被列出。',
  },
  {
    title: '只有要发布到市场才写索引',
    body: '不发布就跳过这步。索引是 `format: 1` 的 JSON，官方校验器逐条硬校验：',
    bullets: [
      '**`version`** 必须是精确 SemVer（不能 `^1.0.0`）；**`publishTimestamp`** 必须是整数 Unix 秒，写成毫秒会被拒。',
      '**git 来源的 `commit`** 必须是 40 位小写 hex；`repository.url` 是不带凭据 / 查询 / 片段的绝对 https。',
      '**`engines.dsh`** 必须与该 commit 上的 `package.json` 一致：省略 = 任意 DSH 版本，写成 `{}` 等于向市场宣称无要求，宿主装完仍会复核真实包并可能拒装回滚。',
      '`metadata.category` / `labels` / `sortKeys` 用的 id 必须先在顶层 `metadata` 里声明。',
      '**索引只收已发布版本**；分支是活口、随时被上游重写，不要写进索引。',
      '`official` 标签只属于 DSH 官方，自己维护的索引不要写。',
    ],
    note: '用 `npm run validate:index <文件名>` 过一遍官方校验器。它**不检查**「这个包是不是组合包」，也不检查版本是否与包一致——索引过审 ≠ 装得上。',
  },
  {
    title: '红线',
    bullets: [
      '不伪造 `engines.dsh`；升版必须重抓该 commit 的 `package.json`。',
      '不在 `client.js` 里 require `@deepseek-ai/dsh-client-*`。',
      '不在插件包里写 profile 的 `dsh.profile.bundles`（那是 profile 专属）。',
      '不手改 `~/.dsh` 下的 `cordis.yml`，组合靠 patch 层，改根文件会被覆盖。',
      '模型工具 / 命令 / 配置 schema 的注册 API 尚未验证，需要时先对 DSH 源码，不要照着猜。',
    ],
    note: '完整的字段表、校验器硬规则与施工顺序见「宿主契约」Tab；本项目的目录结构、命令与数据流见「项目 README」Tab。两份文档随本包一起构建，不联网也能读。',
  },
]

function switchTab(next: TabKey): void {
  tab.value = next
  if (body.value !== null) body.value.scrollTop = 0
}

function rich(text: string): string {
  return renderInline(text)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && state.devGuideOpen) closeDevGuide()
}

// 每次打开都从指南首页开始，别停在上次翻到的 README 末尾
watch(
  () => state.devGuideOpen,
  (open) => {
    if (open) tab.value = 'guide'
  },
)

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div v-if="state.devGuideOpen" class="dialog-overlay" @click.self="closeDevGuide()">
    <div class="dialog dev-guide" role="dialog" aria-modal="true" aria-label="开发指南">
      <header class="dev-guide__head">
        <div>
          <h2 class="dialog__title">开发指南</h2>
          <p class="dev-guide__sub">
            开发自己的 {{ HOST.displayName }} 插件 · 内容随本包构建，离线可读
          </p>
        </div>
        <button type="button" class="dev-guide__close" aria-label="关闭" @click="closeDevGuide()">
          ×
        </button>
      </header>

      <div class="dev-guide__tabs" role="tablist">
        <button
          v-for="item in TABS"
          :key="item.key"
          type="button"
          role="tab"
          class="dev-guide__tab"
          :class="{ 'dev-guide__tab--active': tab === item.key }"
          :aria-selected="tab === item.key"
          :title="item.hint"
          @click="switchTab(item.key)"
        >
          {{ item.label }}
        </button>
      </div>

      <div ref="body" class="dev-guide__body">
        <div v-if="tab === 'guide'" class="guide">
          <p class="guide__lead">
            从零做一个能被 {{ HOST.displayName }} 安装、启停的组合包，按这八步走。
            字段与命令都出自本仓库的宿主契约，未经实测的 API 不列进来。
          </p>
          <ol class="guide__steps">
            <li v-for="(step, index) in STEPS" :key="step.title" class="guide__step">
              <span class="guide__num">{{ index + 1 }}</span>
              <div class="guide__content">
                <h3>{{ step.title }}</h3>
                <p v-if="step.body" v-html="rich(step.body)" />
                <pre v-if="step.code"><code>{{ step.code }}</code></pre>
                <ul v-if="step.bullets">
                  <li v-for="(item, n) in step.bullets" :key="n" v-html="rich(item)" />
                </ul>
                <p v-if="step.note" class="guide__note" v-html="rich(step.note)" />
              </div>
            </li>
          </ol>
        </div>

        <article v-else-if="tab === 'readme'" class="md" v-html="readmeHtml" />
        <article v-else class="md" v-html="specHtml" />
      </div>

      <footer class="dev-guide__foot">
        <span>README.md 与 docs/hosts/dsh-spec.md 随本包一起构建</span>
        <button type="button" class="btn btn--primary" @click="closeDevGuide()">知道了</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.dev-guide {
  width: min(840px, calc(100vw - 48px));
  max-height: 84vh;
  padding: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dev-guide__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 24px 14px;
}

.dev-guide__sub {
  margin: 5px 0 0;
  font-size: 12.5px;
  color: var(--color-text-secondary);
}

.dev-guide__close {
  flex: none;
  width: 30px;
  height: 30px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: #ffffff;
  color: var(--color-text-secondary);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}

.dev-guide__close:hover {
  background: var(--color-surface-hover);
  color: var(--color-text);
}

.dev-guide__tabs {
  display: flex;
  gap: 6px;
  padding: 0 24px;
  border-bottom: 1px solid var(--color-border);
}

.dev-guide__tab {
  padding: 9px 14px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--color-text-secondary);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.dev-guide__tab:hover {
  color: var(--color-text);
}

.dev-guide__tab--active {
  border-bottom-color: var(--color-primary);
  color: var(--color-text);
}

.dev-guide__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 18px 24px 24px;
  font-size: 13.5px;
  line-height: 1.72;
  color: var(--color-text-body);
}

.dev-guide__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 24px;
  border-top: 1px solid var(--color-border);
  font-size: 12px;
  color: var(--color-text-muted);
}

.guide__lead {
  margin: 0 0 18px;
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--color-surface);
  color: var(--color-text-body);
}

.guide__steps {
  list-style: none;
  margin: 0;
  padding: 0;
}

.guide__step {
  display: flex;
  gap: 12px;
  padding-bottom: 20px;
}

.guide__step + .guide__step {
  border-top: 1px solid var(--color-border-light);
  padding-top: 20px;
}

.guide__num {
  flex: none;
  width: 24px;
  height: 24px;
  border-radius: 7px;
  background: var(--color-primary);
  color: #ffffff;
  font-size: 12px;
  font-weight: 700;
  text-align: center;
  line-height: 24px;
}

.guide__content {
  min-width: 0;
  flex: 1;
}

.guide__content h3 {
  margin: 0 0 8px;
  font-size: 14.5px;
  font-weight: 700;
  color: var(--color-text);
}

.guide__content p {
  margin: 0 0 10px;
}

.guide__content ul {
  margin: 8px 0 10px;
  padding-left: 20px;
}

.guide__content li {
  margin-bottom: 5px;
}

.guide__note {
  padding: 8px 12px;
  border-left: 3px solid var(--color-border-strong);
  background: var(--color-surface);
  border-radius: 0 8px 8px 0;
}

/* ============ 内嵌文档排版（v-html 内容用 :deep 才能命中） ============ */

.dev-guide__body :deep(pre) {
  margin: 10px 0 14px;
  padding: 12px 14px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-surface);
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre;
}

.dev-guide__body :deep(code) {
  padding: 1px 5px;
  border-radius: 5px;
  background: var(--color-surface-hover);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.92em;
}

.dev-guide__body :deep(pre code) {
  padding: 0;
  background: transparent;
  font-size: inherit;
}

.dev-guide__body :deep(h1) {
  margin: 0 0 14px;
  font-size: 20px;
  color: var(--color-text);
}

.dev-guide__body :deep(h2) {
  margin: 26px 0 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--color-border);
  font-size: 16.5px;
  color: var(--color-text);
}

.dev-guide__body :deep(h3) {
  margin: 20px 0 8px;
  font-size: 14.5px;
  color: var(--color-text);
}

.dev-guide__body :deep(h4),
.dev-guide__body :deep(h5),
.dev-guide__body :deep(h6) {
  margin: 16px 0 6px;
  font-size: 13.5px;
  color: var(--color-text);
}

.dev-guide__body :deep(p) {
  margin: 0 0 10px;
}

.dev-guide__body :deep(ul),
.dev-guide__body :deep(ol) {
  margin: 8px 0 12px;
  padding-left: 22px;
}

.dev-guide__body :deep(li) {
  margin-bottom: 4px;
}

.dev-guide__body :deep(.md-li--sub) {
  margin-left: 18px;
  list-style: circle;
}

.dev-guide__body :deep(blockquote) {
  margin: 10px 0 14px;
  padding: 8px 14px;
  border-left: 3px solid var(--color-border-strong);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  border-radius: 0 8px 8px 0;
}

.dev-guide__body :deep(hr) {
  margin: 22px 0;
  border: none;
  border-top: 1px solid var(--color-border);
}

.dev-guide__body :deep(a) {
  color: var(--color-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.dev-guide__body :deep(.md-table) {
  margin: 12px 0 16px;
  overflow-x: auto;
}

.dev-guide__body :deep(table) {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}

.dev-guide__body :deep(th),
.dev-guide__body :deep(td) {
  padding: 7px 10px;
  border: 1px solid var(--color-border);
  text-align: left;
  vertical-align: top;
}

.dev-guide__body :deep(th) {
  background: var(--color-surface);
  font-weight: 700;
  color: var(--color-text);
}
</style>
