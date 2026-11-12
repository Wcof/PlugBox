<script setup lang="ts">
import { computed } from 'vue'
import type { InstalledBundle } from '../../types/plugin'
import { BUNDLE_ORIGIN_LABEL, BUNDLE_ORIGIN_TAG, bundleOrigin } from '../../types/plugin'
import { pluginCenter } from '../../stores/pluginCenter'
import AppIcon from '../icons/AppIcon.vue'
import PluginTile from './PluginTile.vue'

const props = defineProps<{ bundle: InstalledBundle }>()

const { state, updateOne, setEnabled, removeByName, openDetail, gotoStore } = pluginCenter

const missing = computed(() => props.bundle.availability === 'missing')
const running = computed(() => props.bundle.enabled)
const updatable = computed(() => pluginCenter.isUpdatable(props.bundle))
/** 检查更新读到的仓库分支变更：只提示，装哪个分支由用户在市场卡片里选 */
const branchUpdates = computed(() => pluginCenter.branchUpdatesOf(props.bundle.name))
const branchHint = computed(() =>
  branchUpdates.value
    .map((item) => `${item.branch}${item.version ? ` v${item.version}` : ''}`)
    .join('、'),
)
const locked = computed(
  () => props.bundle.readOnlyReason !== undefined || !props.bundle.installed,
)
const origin = computed(() => bundleOrigin(props.bundle))

const busyKey = (key: string) => state.busy[key] === true
const updating = computed(() => busyKey(`update:${props.bundle.name}`))
const toggling = computed(() => busyKey(`toggle:${props.bundle.name}`))
const removing = computed(() => busyKey(`remove:${props.bundle.name}`))
const updateLocked = computed(() => updating.value || state.updatingAll)

const status = computed<{ text: string; class: string }>(() => {
  if (missing.value) return { text: '包不可用', class: 'status--warn' }
  if (running.value) return { text: '运行中', class: 'status--running' }
  return { text: '已停用', class: 'status--stopped' }
})

const rowSummary = computed(() => {
  const total = props.bundle.rows.length
  if (total === 0) return '无可读插件行'
  const active = props.bundle.rows.filter((row) => row.enabled).length
  return `${active}/${total} 个插件行启用`
})

const sourceIcon = computed(() => {
  const source = (props.bundle.source ?? '').trim().toLowerCase()
  if (source.startsWith('link:') || origin.value === 'local') return 'folder-open'
  if (source.startsWith('git')) return 'link'
  return 'download'
})

function onToggle(): void {
  void setEnabled(props.bundle.name, !running.value)
}
</script>

<template>
  <article class="plugin-card" :class="{ 'plugin-card--muted': !running }">
    <div class="plugin-card__header">
      <PluginTile :icon="bundle.icon" :muted="!running" />
      <div class="plugin-card__titles">
        <div class="plugin-card__titlerow">
          <span class="plugin-card__name">{{ bundle.title }}</span>
          <span class="tag" :class="BUNDLE_ORIGIN_TAG[origin]">{{ BUNDLE_ORIGIN_LABEL[origin] }}</span>
          <span v-if="bundle.official && bundle.optional" class="tag tag--gray">随附</span>
          <span v-if="updatable" class="tag tag--amber">可更新</span>
          <span v-if="branchUpdates.length" class="tag tag--blue" :title="branchHint">
            分支有更新
          </span>
        </div>
        <div class="plugin-card__id">{{ bundle.name }}</div>
      </div>
      <span class="status plugin-card__status" :class="status.class">
        <span class="status__dot" />
        {{ status.text }}
      </span>
    </div>

    <p class="plugin-card__desc">{{ bundle.description || '该组合包没有提供描述。' }}</p>

    <div v-if="bundle.source || bundle.error" class="plugin-card__facts">
      <div v-if="bundle.source" class="plugin-card__fact">
        <span><AppIcon :name="sourceIcon" :size="14" /></span>
        <span class="mono">{{ bundle.source }}</span>
      </div>
      <div v-if="bundle.error" class="plugin-card__fact plugin-card__fact--warn">
        <span><AppIcon name="alert-circle" :size="14" /></span>
        <span>加载失败：{{ bundle.error.code }}</span>
      </div>
    </div>

    <div class="plugin-card__divider">
      <div class="plugin-card__foot">
        <span class="plugin-card__version mono" :class="{ 'plugin-card__version--updatable': updatable }">
          <template v-if="updatable">v{{ bundle.version ?? '未知' }} → {{ bundle.latestVersion }}</template>
          <template v-else>v{{ bundle.version ?? '未知' }}</template>
        </span>
        <span v-if="!missing" class="plugin-card__dot">·</span>
        <span v-if="!missing" class="plugin-card__rows">{{ rowSummary }}</span>

        <span class="plugin-card__actions">
          <template v-if="missing">
            <button type="button" class="btn btn--secondary btn--sm" @click="gotoStore()">
              <AppIcon name="download" :size="15" />
              去市场重装
            </button>
          </template>
          <template v-else>
            <button
              v-if="updatable"
              type="button"
              class="btn btn--primary btn--sm"
              :disabled="updateLocked"
              @click="updateOne(bundle.name)"
            >
              <span v-if="updating" class="spinner" />
              <AppIcon v-else name="download" :size="15" />
              更新
            </button>
            <button
              type="button"
              class="btn btn--secondary btn--sm"
              :disabled="toggling || bundle.readOnlyReason !== undefined"
              :title="bundle.readOnlyReason ? '这个包是插件管理所需，不能停用' : undefined"
              @click="onToggle"
            >
              <span v-if="toggling" class="spinner" />
              {{ running ? '停用' : '启用' }}
            </button>
            <button
              type="button"
              class="btn btn--secondary btn--sm"
              @click="openDetail(bundle.name)"
            >
              <AppIcon name="sliders" :size="15" />
              详情
            </button>
          </template>
          <button
            v-if="bundle.removable && !bundle.readOnlyReason"
            type="button"
            class="btn btn--danger-ghost btn--sm btn--icon"
            :disabled="removing || locked"
            :aria-label="`卸载 ${bundle.title}`"
            @click="removeByName(bundle.name)"
          >
            <span v-if="removing" class="spinner" />
            <AppIcon v-else name="trash" :size="15" />
          </button>
        </span>
      </div>
    </div>
  </article>
</template>
