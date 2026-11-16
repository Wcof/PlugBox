<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { MarketEntry, RepoBranch } from '../../types/plugin'
import { MARKET_LABEL_TAG, MARKET_LABEL_TEXT, githubRepoOf, HOST } from '../../types/plugin'
import { compareVersions } from '../../core/protocol/version'
import { hostRequirementOf } from '../../core/manifest'
import { pluginCenter } from '../../stores/pluginCenter'
import AppIcon from '../icons/AppIcon.vue'
import PluginTile from './PluginTile.vue'

const props = withDefaults(defineProps<{ entry: MarketEntry; dense?: boolean }>(), {
  dense: false,
})

const { state, installEntry, openDetail, loadRepoBranches, installBranchAt } = pluginCenter

const installing = computed(() => state.busy[`install:${props.entry.name}`] === true)

/** 只有能定位到 GitHub 仓库的条目才谈得上按分支安装 */
const repo = computed(() => githubRepoOf(props.entry.repository, props.entry.homepage))

const preferredVersion = computed(
  () =>
    props.entry.versions.find((version) => version.version === props.entry.defaultVersion) ??
    props.entry.versions[0],
)

const versionLabel = computed(
  () => props.entry.defaultVersion ?? preferredVersion.value?.version ?? '未知',
)

/**
 * 不兼容只针对「当前推荐的这个版本」：标注跟着收录版本走，
 * 上游发布兼容的新版本、索引换成新版后，这里自然就不再显示。
 */
const incompatible = computed(() => preferredVersion.value?.compatible === false)

/** 宿主给出的未满足要求：字段名（如 engines.dsh）由适配器翻译成带命名空间的键 */
const requiredRange = computed(() => hostRequirementOf(HOST, preferredVersion.value?.requirements, 'engines.dsh'))

/** 文案里带上具体版本号：说的是这一版装不上，不是整个插件被拉黑 */
const incompatibilityLead = computed(
  () => `${versionLabel.value === '未知' ? '这一版' : `v${versionLabel.value} `}与当前${HOST.displayName}版本不兼容`,
)

const incompatibilityText = computed(() =>
  requiredRange.value
    ? `${incompatibilityLead.value}（要求${HOST.displayName} ${requiredRange.value}）`
    : incompatibilityLead.value,
)

/**
 * 已装版本：宿主搜索结果给了 installedVersion 就用；没给（部分路径不返回）时
 * 回退到 listBundles 里同名组合包的版本——那是安装事实的另一半来源，缺了它
 * 「装了分支的新版」在卡片上就无迹可寻。
 */
const installedVersion = computed(
  () =>
    props.entry.installation.installedVersion ??
    state.bundles.find((bundle) => bundle.name === props.entry.name)?.version,
)

/**
 * 已装版本与收录版本不一致（典型：按分支装了还没发版的新版）时，
 * 主版本号改显示「正在运行的那一个」——版本号按钮同时是按分支安装的入口，
 * 显示你实际装着的版本才不会让人以为装旧了。收录版本照样在旁边标出来。
 * 已装低于收录（可更新）时不交换：主版本号保持收录版本，旁边显示「已装 v…」。
 */
const runningDifferentVersion = computed(() => {
  const installed = installedVersion.value
  if (installed === undefined || versionLabel.value === '未知') return false
  if (installed === versionLabel.value) return false
  return compareVersions(installed, versionLabel.value) >= 0
})

const status = computed<{ text: string; class: string }>(() => {
  const installation = props.entry.installation.status
  // 推荐版本装不上时，状态栏不能再写「可安装 / 可更新」
  if (
    incompatible.value &&
    (installation === 'not-installed' || installation === 'update-available')
  ) {
    return {
      text: installation === 'update-available' ? '更新受阻' : '不可安装',
      class: 'status--warn',
    }
  }
  switch (installation) {
    case 'update-available':
      return { text: '可更新', class: 'status--warn' }
    case 'different-version': {
      // 装的比收录的还新（分支装了未发版）：如实说「已装更新版本」，别让人以为装旧了
      const ahead =
        installedVersion.value !== undefined &&
        versionLabel.value !== '未知' &&
        compareVersions(installedVersion.value, versionLabel.value) > 0
      return ahead
        ? { text: '已装更新版本', class: 'status--running' }
        : { text: '已装其他版本', class: 'status--warn' }
    }
    case 'installed':
      return { text: '已安装', class: 'status--running' }
    case 'provided':
      return { text: `随${HOST.displayName}提供`, class: 'status--running' }
    default:
      return { text: '可安装', class: 'status--stopped' }
  }
})

const action = computed<'install' | 'update' | 'detail'>(() => {
  if (props.entry.installation.status === 'update-available') return 'update'
  if (props.entry.installation.status === 'not-installed') return 'install'
  return 'detail'
})

const repositoryLabel = computed(() => {
  const url = props.entry.repository
  if (!url) return ''
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '')
})

// ============ 版本号下拉：按分支安装 ============

const root = ref<HTMLElement | null>(null)
const branchOpen = ref(false)
const branchStatus = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const branches = ref<RepoBranch[]>([])
const branchError = ref('')

/** 已装来源里的 ref（# 之后那段）：精确比对分支名，避免 main 命中 main-2 */
const installedRef = computed(() => {
  const source = state.bundles.find((bundle) => bundle.name === props.entry.name)?.source ?? ''
  const at = source.lastIndexOf('#')
  return at === -1 ? '' : source.slice(at + 1)
})

const isInstalled = (branch: RepoBranch): boolean => installedRef.value === branch.name

const busyOf = (branch: RepoBranch): boolean =>
  state.busy[`branch-install:${repo.value}#${branch.name}`] === true

async function refreshBranches(): Promise<void> {
  if (repo.value === null) return
  branchStatus.value = 'loading'
  branchError.value = ''
  const result = await loadRepoBranches(repo.value)
  if (result.ok) {
    branches.value = result.branches
    branchStatus.value = 'ready'
    return
  }
  branches.value = []
  branchStatus.value = 'error'
  branchError.value = result.error ?? '读取分支失败'
}

async function toggleBranches(): Promise<void> {
  if (repo.value === null) return
  if (branchOpen.value) {
    branchOpen.value = false
    return
  }
  branchOpen.value = true
  if (branchStatus.value !== 'ready') await refreshBranches()
}

async function installFromBranch(branch: RepoBranch): Promise<void> {
  if (repo.value === null) return
  const done = await installBranchAt(props.entry, repo.value, branch)
  if (done) branchOpen.value = false
}

function onDocumentClick(event: MouseEvent): void {
  if (root.value !== null && !root.value.contains(event.target as Node)) branchOpen.value = false
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') branchOpen.value = false
}

function attachDocumentListeners(open: boolean): void {
  if (open) {
    document.addEventListener('click', onDocumentClick, true)
    document.addEventListener('keydown', onKeydown)
    return
  }
  document.removeEventListener('click', onDocumentClick, true)
  document.removeEventListener('keydown', onKeydown)
}

// 只在分支下拉真的打开时挂监听：120 张卡各挂两个 document 监听器是纯浪费
watch(branchOpen, attachDocumentListeners)

onBeforeUnmount(() => attachDocumentListeners(false))
</script>

<template>
  <article
    ref="root"
    class="plugin-card"
    :class="{ 'plugin-card--open': branchOpen, 'plugin-card--dense': dense }"
  >
    <div class="plugin-card__header">
      <PluginTile :icon="entry.icon" />
      <div class="plugin-card__titles">
        <div class="plugin-card__titlerow">
          <span class="plugin-card__name">{{ entry.title }}</span>
          <span class="tag" :class="MARKET_LABEL_TAG[entry.label]">
            {{ MARKET_LABEL_TEXT[entry.label] }}
          </span>
        </div>
        <div class="plugin-card__id">{{ entry.name }}</div>
      </div>
      <span class="status plugin-card__status" :class="status.class">
        <span class="status__dot" />
        {{ status.text }}
      </span>
    </div>

    <p class="plugin-card__desc">{{ entry.description || '该插件没有提供描述。' }}</p>

    <div class="plugin-card__facts">
      <div v-if="entry.author" class="plugin-card__fact">
        <span><AppIcon name="users" :size="14" /></span>
        <span>{{ entry.author }}</span>
      </div>
      <div v-if="repositoryLabel" class="plugin-card__fact plugin-card__fact--repo">
        <span><AppIcon name="link" :size="14" /></span>
        <span class="mono">{{ repositoryLabel }}</span>
      </div>
      <div v-if="incompatible" class="plugin-card__fact plugin-card__fact--warn">
        <span><AppIcon name="alert-circle" :size="14" /></span>
        <span
          >{{ incompatibilityLead }}<template v-if="requiredRange"
            >（要求{{ HOST.displayName }} <span class="mono">{{ requiredRange }}</span>）</template
          ></span
        >
      </div>
    </div>

    <div class="plugin-card__divider">
      <div class="plugin-card__foot">
        <button
          v-if="repo"
          type="button"
          class="plugin-card__version plugin-card__version--button mono"
          :aria-expanded="branchOpen"
          :title="runningDifferentVersion ? '当前运行 v' + installedVersion + '；点开选择分支安装' : '点开选择分支安装'"
          @click="toggleBranches()"
        >
          v{{ runningDifferentVersion ? installedVersion : versionLabel }}
          <AppIcon name="chevron-down" :size="13" />
        </button>
        <span v-else class="plugin-card__version mono">v{{ versionLabel }}</span>

        <template v-if="runningDifferentVersion">
          <span class="plugin-card__dot">·</span>
          <span class="plugin-card__rows">收录 v{{ versionLabel }}</span>
        </template>
        <template v-else-if="installedVersion">
          <span class="plugin-card__dot">·</span>
          <span class="plugin-card__rows">已装 v{{ installedVersion }}</span>
        </template>

        <span class="plugin-card__actions">
          <button
            v-if="action === 'detail'"
            type="button"
            class="btn btn--secondary btn--sm"
            @click="openDetail(entry.name)"
          >
            <AppIcon name="sliders" :size="15" />
            详情
          </button>
          <button
            v-else
            type="button"
            class="btn btn--primary btn--sm"
            :disabled="installing || incompatible"
            :title="incompatible ? incompatibilityText : undefined"
            @click="installEntry(entry)"
          >
            <span v-if="installing" class="spinner" />
            <AppIcon v-else :name="action === 'update' ? 'refresh' : 'download'" :size="15" />
            {{ action === 'update' ? '更新' : '安装' }}
          </button>
        </span>
      </div>

      <div v-if="branchOpen" class="branch-pop" role="dialog" aria-label="选择分支安装">
        <div class="branch-pop__head">
          <span class="branch-pop__title">选择分支安装</span>
          <button
            type="button"
            class="branch-pop__action"
            :disabled="branchStatus === 'loading'"
            @click="refreshBranches()"
          >
            刷新
          </button>
          <button
            type="button"
            class="branch-pop__action"
            aria-label="关闭"
            @click="branchOpen = false"
          >
            <AppIcon name="x" :size="14" />
          </button>
        </div>

        <p class="branch-pop__hint">
          装的是该分支当前的头提交，上游后续推送会改变它；这类分支通常还没发版。
        </p>

        <p v-if="branchStatus === 'loading'" class="branch-pop__hint">正在读取分支…</p>
        <p v-else-if="branchStatus === 'error'" class="branch-pop__hint branch-pop__hint--error">
          {{ branchError }}
        </p>

        <ul v-else class="branch-pop__list">
          <li v-for="branch in branches" :key="branch.name" class="branch-pop__item">
            <div class="branch-pop__main">
              <div class="branch-pop__name mono">{{ branch.name }}</div>
              <div class="branch-pop__meta">
                <span v-if="branch.version" class="mono">v{{ branch.version }}</span>
                <span v-else class="branch-pop__muted">没有 package.json</span>
                <span v-if="branch.enginesDsh" class="branch-pop__chip">
                  要求{{ HOST.displayName }} <span class="mono">{{ branch.enginesDsh }}</span>
                </span>
                <span v-if="!branch.bundle" class="branch-pop__chip branch-pop__chip--warn">
                  未声明组合包
                </span>
                <span v-if="isInstalled(branch)" class="branch-pop__chip branch-pop__chip--ok">
                  当前已装
                </span>
              </div>
              <p v-if="branch.description" class="branch-pop__desc">{{ branch.description }}</p>
            </div>
            <button
              type="button"
              class="btn btn--primary btn--sm"
              :disabled="!branch.bundle || busyOf(branch)"
              :title="
                branch.bundle
                  ? undefined
                  : `这个分支没声明组合包，装进${HOST.displayName}里不能按插件管理`
              "
              @click="installFromBranch(branch)"
            >
              <span v-if="busyOf(branch)" class="spinner" />
              {{ isInstalled(branch) ? '重装' : '安装' }}
            </button>
          </li>
        </ul>
      </div>
    </div>
  </article>
</template>

<style scoped>
.plugin-card {
  position: relative;
}

/* 下拉展开时压住相邻卡片 */
.plugin-card--open {
  z-index: 6;
}

.plugin-card__divider {
  position: relative;
}

.plugin-card__version--button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  margin-left: -6px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: inherit;
  font-size: inherit;
  font-family: var(--font-mono);
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
}

.plugin-card__version--button:hover {
  background: var(--color-surface-hover);
  color: var(--color-text);
}

.plugin-card__version--button:focus-visible {
  outline: none;
  box-shadow: var(--ring);
}

.branch-pop {
  position: absolute;
  left: 0;
  bottom: calc(100% + 10px);
  width: min(520px, 100%);
  max-height: 380px;
  display: flex;
  flex-direction: column;
  padding: 14px 16px 12px;
  background: #ffffff;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  box-shadow: 0 12px 32px rgba(17, 24, 39, 0.12);
  z-index: 20;
  animation: branch-pop-in 0.14s ease-out;
}

@keyframes branch-pop-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.branch-pop__head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.branch-pop__title {
  flex: 1;
  font-size: 13.5px;
  font-weight: 700;
}

.branch-pop__action {
  display: inline-flex;
  align-items: center;
  padding: 2px 7px;
  border: 1px solid var(--color-border);
  border-radius: 7px;
  background: #ffffff;
  color: var(--color-text-secondary);
  font-size: 12px;
  cursor: pointer;
}

.branch-pop__action:hover:not(:disabled) {
  border-color: var(--color-border-strong);
  color: var(--color-text);
}

.branch-pop__action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.branch-pop__hint {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.55;
  color: var(--color-text-secondary);
}

.branch-pop__hint--error {
  color: var(--amber-text);
}

.branch-pop__list {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.branch-pop__item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 9px 0;
  border-top: 1px solid var(--color-border-light);
}

.branch-pop__item:first-child {
  border-top: 0;
  padding-top: 4px;
}

.branch-pop__main {
  flex: 1;
  min-width: 0;
}

.branch-pop__name {
  font-size: 12.5px;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.branch-pop__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 3px;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.branch-pop__muted {
  color: var(--color-text-muted);
}

.branch-pop__desc {
  margin: 5px 0 0;
  font-size: 12px;
  line-height: 1.55;
  color: var(--color-text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.branch-pop__chip {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--color-surface-hover);
  font-size: 11px;
  white-space: nowrap;
}

.branch-pop__chip--warn {
  background: var(--amber-bg);
  color: var(--amber-text);
}

.branch-pop__chip--ok {
  background: var(--green-bg);
  color: var(--green-text);
}
</style>
