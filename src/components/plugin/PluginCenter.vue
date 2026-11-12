<script setup lang="ts">
import { computed } from 'vue'
import { pluginCenter } from '../../stores/pluginCenter'
import { MARKET_CATEGORY_LABEL, MARKET_LABEL_TEXT, HOST } from '../../types/plugin'
import { BRAND } from '../../core/protocol/brand'
import type { LocalFilter } from '../../types/plugin'
import AppIcon from '../icons/AppIcon.vue'
import LocalPluginCard from './LocalPluginCard.vue'
import StorePluginCard from './StorePluginCard.vue'
import FilterSelect from '../ui/FilterSelect.vue'

const {
  state,
  localBase,
  localStats,
  storeStats,
  storeConditions,
  storeTruncated,
  authorFacets,
  authorFacetsHidden,
  authorFacetTotal,
  authorFacetOverflow,
  toggleAuthorFacets,
  setStoreAuthor,
  categoryFacets,
  setStoreCategory,
  visibleStoreCount,
  denseStoreCards,
  filteredLocal,
  renderedStoreGroups,
  storeHasMore,
  showMoreStore,
  updateCount,
  branchUpdateCount,
  switchTab,
  checkUpdates,
  updateAll,
  dismissUpdateNotice,
  openInstallDialog,
  openDevGuide,
  loadLocal,
  loadStore,
  scheduleStoreSearch,
  cancelStoreSearch,
  clearStoreQuery,
  clearStoreCondition,
  subscribeSelfIndex,
  subscribeCommunityIndex,
  gotoStore,
  gotoBranchUpdates,
  setLocalFilter,
  setStoreFilter,
} = pluginCenter

/** 统计卡与筛选 chips 共用同一套分类，点统计卡即筛选 */
const LOCAL_CARDS = [
  { key: 'all', label: '全部插件', chip: '全部', icon: 'box', tint: '' },
  { key: 'official', label: '官方插件', chip: '官方', icon: 'shield-check', tint: 'green' },
  { key: 'third-party', label: '第三方插件', chip: '第三方', icon: 'users', tint: 'blue' },
  { key: 'local', label: '本地安装', chip: '本地', icon: 'monitor', tint: 'violet' },
] as const

const STORE_CARDS = [
  { key: 'all', label: '全部收录', icon: 'box', tint: '' },
  { key: 'official', label: MARKET_LABEL_TEXT.official, icon: 'shield-check', tint: 'green' },
  { key: 'catalog', label: MARKET_LABEL_TEXT.catalog, icon: 'inbox', tint: 'blue' },
  { key: 'third-party', label: '第三方来源', icon: 'users', tint: 'violet' },
  { key: 'installed', label: '已安装', icon: 'circle-check', tint: 'amber' },
  { key: 'available', label: '可安装', icon: 'download', tint: 'blue' },
] as const

const LOCAL_CHIPS: ReadonlyArray<{ key: LocalFilter; label: string }> = LOCAL_CARDS.map(
  ({ key, chip }) => ({ key, label: chip }),
)

/**
 * 市场侧的统计卡按数据出现：只有真的存在某个来源时才显示那一档，
 * 避免订阅了社区目录后还摆着「官方 0 / 第三方 0」两张空卡。
 * 市场侧不再另起一行 chips——统计卡就是唯一的来源筛选入口。
 */
const storeCards = computed(() =>
  STORE_CARDS.filter(
    (card) => card.key === 'all' || card.key === 'installed' || storeStats.value[card.key] > 0,
  ),
)

const LOCAL_SORTS = [
  { value: 'status', label: '状态优先' },
  { value: 'name', label: '按名称' },
  { value: 'package', label: '按包名' },
  { value: 'origin', label: '按来源' },
]

const STORE_SORTS = [
  { value: 'index', label: '索引顺序' },
  { value: 'name', label: '按名称' },
  { value: 'author', label: '按作者' },
  { value: 'installable', label: '未安装优先' },
] as const

const SUBTITLE = {
  local: '管理已安装插件、查看来源并维护插件运行状态',
  store: '浏览已订阅索引源收录的插件，按需安装或更新',
}

/** 本包自带的索引文件：页面挂在宿主给的路由前缀下，必须用相对路径 */
function openIndexSource(): void {
  window.open('./index.json', '_blank', 'noopener')
}

/** 版本更新与分支变更共用一条提示：两类都没有时才收起 */
const updateHeadline = computed(() => {
  const parts: string[] = []
  if (updateCount.value > 0) parts.push(`${updateCount.value} 个可更新插件`)
  if (branchUpdateCount.value > 0) parts.push(`${branchUpdateCount.value} 项分支变更`)
  if (state.blockedUpdateCount > 0) parts.push(`${state.blockedUpdateCount} 个新版受兼容限制`)
  return `发现 ${parts.join('、')}`
})

const listLoading = (tab: 'local' | 'store') =>
  tab === 'local' ? state.localStatus === 'loading' : state.storeStatus === 'loading'

const listError = (tab: 'local' | 'store') =>
  tab === 'local' ? state.localStatus === 'error' : state.storeStatus === 'error'

const hostOffline = () => state.hostOnline === false

const localIdle = () => state.localStatus === 'ready' && !listError('local')

const nothingInstalled = () => localIdle() && localBase.value.length === 0

const noLocalMatch = () =>
  localIdle() && localBase.value.length > 0 && filteredLocal.value.length === 0

/** 市场里一条都不匹配（筛选/分类把结果筛空）：列表区要自证，不能留白 */
const noStoreMatch = () =>
  state.storeStatus === 'ready' && state.market.length > 0 && visibleStoreCount.value === 0

/** 搜索把索引搜空了：索引有内容、结果 0 条，和「索引里没有插件」不是一回事 */
const storeSearchEmpty = () =>
  state.storeStatus === 'ready' &&
  state.indexes.length > 0 &&
  state.market.length === 0 &&
  state.storeQuery.trim().length > 0

/** 索引本身没有任何条目（连关键词都没有时） */
const storeIndexEmpty = () =>
  state.storeStatus === 'ready' &&
  state.market.length === 0 &&
  state.storeQuery.trim().length === 0

const indexErrorList = () => Object.entries(state.indexErrors)

function clearLocalFilters(): void {
  state.localQuery = ''
  state.localFilter = 'all'
}

function clearStoreFilters(): void {
  // 先把条件清干净：被作废的加载若还要补发，补发的那轮就该用清干净的状态
  state.storeQuery = ''
  state.storeFilter = 'all'
  state.storeAuthors = []
  state.storeCategories = []
  if (!cancelStoreSearch()) void loadStore()
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
</script>

<template>
  <div class="page">
    <div class="page__head">
      <div class="page__head-top">
        <div class="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            class="tabs__tab"
            :class="{ 'tabs__tab--active': state.activeTab === 'local' }"
            :aria-selected="state.activeTab === 'local'"
            @click="switchTab('local')"
          >
            插件管理
          </button>
          <button
            type="button"
            role="tab"
            class="tabs__tab"
            :class="{ 'tabs__tab--active': state.activeTab === 'store' }"
            :aria-selected="state.activeTab === 'store'"
            @click="switchTab('store')"
          >
            插件市场
          </button>
        </div>

        <div class="page__actions">
          <button
            type="button"
            class="btn btn--secondary"
            :disabled="state.checkingUpdates || listLoading(state.activeTab)"
            @click="checkUpdates()"
          >
            <span v-if="state.checkingUpdates" class="spinner" />
            <AppIcon v-else name="refresh" :size="16" />
            检查更新
          </button>

          <button
            v-if="state.activeTab === 'local' && updateCount > 0"
            type="button"
            class="btn btn--secondary"
            :disabled="state.updatingAll"
            @click="updateAll()"
          >
            <span v-if="state.updatingAll" class="spinner" />
            <AppIcon v-else name="download" :size="16" />
            一键更新
            <span class="chip__count">{{ updateCount }}</span>
          </button>

          <button
            type="button"
            class="btn btn--primary"
            :disabled="state.busy.installSpec"
            @click="openInstallDialog()"
          >
            <AppIcon name="plus" :size="16" />
            安装插件
          </button>

          <button
            type="button"
            class="btn btn--secondary"
            title="查看内嵌的插件开发指南、项目 README 与宿主契约"
            @click="openDevGuide()"
          >
            <AppIcon name="book-open" :size="16" />
            开发指南
          </button>
        </div>
      </div>

      <p class="page__subtitle">{{ SUBTITLE[state.activeTab] }}</p>
    </div>

    <div
      v-if="(updateCount + branchUpdateCount + state.blockedUpdateCount) > 0 && !state.updateNoticeDismissed"
      class="update-notice"
      role="status"
    >
      <span class="update-notice__icon"><AppIcon name="download" :size="18" /></span>
      <div class="update-notice__text">
        <strong>{{ updateHeadline }}</strong>
        <span>版本来自订阅的索引源，分支变更来自插件仓库；更新前不会自动改动任何东西</span>
        <span v-if="state.blockedUpdateCount > 0">受兼容限制的新版需升级宿主后再安装</span>
        <span v-if="branchUpdateCount > 0" class="update-notice__branches">
          <span
            v-for="item in state.branchUpdates.slice(0, 3)"
            :key="`${item.repo}#${item.branch}`"
            class="update-notice__branch"
          >
            {{ item.title }} · {{ item.branch }}<template v-if="item.version"> v{{ item.version }}</template>
            <template v-if="item.reason === 'new'">（新分支）</template>
            <template v-else-if="item.reason === 'head'">（有新提交）</template>
          </span>
          <span v-if="branchUpdateCount > 3" class="update-notice__branch">
            等 {{ branchUpdateCount }} 项
          </span>
        </span>
      </div>
      <div class="update-notice__actions">
        <button
          v-if="updateCount > 0"
          type="button"
          class="btn btn--primary btn--sm"
          :disabled="state.updatingAll"
          @click="updateAll()"
        >
          <span v-if="state.updatingAll" class="spinner" />
          一键更新
        </button>
        <button
          v-if="branchUpdateCount > 0"
          type="button"
          class="btn btn--secondary btn--sm"
          @click="gotoBranchUpdates()"
        >
          查看分支
        </button>
        <button type="button" class="btn btn--secondary btn--sm" @click="dismissUpdateNotice()">
          稍后
        </button>
      </div>
    </div>

    <!-- 插件管理 -->
    <template v-if="state.activeTab === 'local'">
      <section v-if="localIdle()" class="stats" aria-label="插件来源统计">
        <button
          v-for="card in LOCAL_CARDS"
          :key="card.key"
          type="button"
          class="stat"
          :class="{ 'stat--active': state.localFilter === card.key && card.key !== 'all' }"
          :aria-pressed="state.localFilter === card.key"
          @click="setLocalFilter(card.key)"
        >
          <span class="stat__icon" :class="card.tint ? `stat__icon--${card.tint}` : ''">
            <AppIcon :name="card.icon" :size="19" />
          </span>
          <span class="stat__text">
            <span class="stat__label">{{ card.label }}</span>
            <span class="stat__value">{{ localStats[card.key] }}</span>
          </span>
        </button>
      </section>

      <div class="filters">
        <div class="search">
          <span class="search__icon"><AppIcon name="search" :size="16" /></span>
          <input
            v-model="state.localQuery"
            type="search"
            class="search__input"
            placeholder="搜索插件名称或 ID"
            aria-label="搜索本地插件"
          />
          <button
            v-if="state.localQuery"
            type="button"
            class="search__clear"
            aria-label="清空搜索"
            @click="state.localQuery = ''"
          >
            <AppIcon name="x" :size="15" />
          </button>
        </div>

        <div class="chips" role="group" aria-label="按来源筛选">
          <button
            v-for="chip in LOCAL_CHIPS"
            :key="chip.key"
            type="button"
            class="chip"
            :class="{ 'chip--active': state.localFilter === chip.key }"
            :aria-pressed="state.localFilter === chip.key"
            @click="setLocalFilter(chip.key)"
          >
            {{ chip.label }}
            <span class="chip__count">{{ localStats[chip.key] }}</span>
          </button>
        </div>

        <div class="filters__tail">
          <FilterSelect
            v-model="state.localSort"
            :options="LOCAL_SORTS"
            prefix="排序"
            leading-icon="arrow-up-down"
            aria-label="插件管理排序方式"
          />
          <button
            type="button"
            class="filters__icon-btn"
            :disabled="listLoading('local')"
            aria-label="刷新插件列表"
            @click="loadLocal()"
          >
            <span v-if="listLoading('local')" class="spinner" />
            <AppIcon v-else name="refresh" :size="16" />
            刷新
          </button>
        </div>
      </div>

      <div v-if="listLoading('local')" class="card-grid">
        <div v-for="n in 6" :key="n" class="skeleton-card" />
      </div>

      <div v-else-if="listError('local')" class="state-box">
        <span class="state-box__icon"><AppIcon name="alert-circle" :size="40" /></span>
        <span class="state-box__title">{{ hostOffline() ? `没连上 ${HOST.displayName}` : '插件列表加载失败' }}</span>
        <span class="state-box__hint">
          {{
            hostOffline()
              ? `${BRAND.name}要在宿主里打开才有插件数据；npm run dev 只用于调页面样式`
              : '宿主返回了错误，请稍后重试'
          }}
        </span>
        <button type="button" class="btn btn--secondary state-box__action" @click="loadLocal()">
          重试
        </button>
      </div>

      <div v-else-if="nothingInstalled()" class="state-box">
        <span class="state-box__icon"><AppIcon name="inbox" :size="40" /></span>
        <span class="state-box__title">这个 profile 还没有安装插件</span>
        <span class="state-box__hint">去插件市场挑一个，或用「安装插件」直接填包名</span>
        <button type="button" class="btn btn--primary state-box__action" @click="gotoStore()">
          前往插件市场
        </button>
      </div>

      <div v-else-if="noLocalMatch()" class="state-box">
        <span class="state-box__icon"><AppIcon name="search" :size="40" /></span>
        <span class="state-box__title">没有符合条件的插件</span>
        <span class="state-box__hint">换个包名片段、插件行名称，或回到全部分类</span>
        <button type="button" class="btn btn--secondary state-box__action" @click="clearLocalFilters()">
          清除搜索与筛选
        </button>
      </div>

      <div v-else class="card-grid">
        <LocalPluginCard v-for="bundle in filteredLocal" :key="bundle.name" :bundle="bundle" />
      </div>
    </template>

    <!-- 插件市场 -->
    <template v-else>
      <section v-if="state.market.length > 0" class="stats" aria-label="收录来源统计">
        <button
          v-for="card in storeCards"
          :key="card.key"
          type="button"
          class="stat"
          :class="{ 'stat--active': state.storeFilter === card.key && card.key !== 'all' }"
          :aria-pressed="state.storeFilter === card.key"
          @click="setStoreFilter(card.key)"
        >
          <span class="stat__icon" :class="card.tint ? `stat__icon--${card.tint}` : ''">
            <AppIcon :name="card.icon" :size="19" />
          </span>
          <span class="stat__text">
            <span class="stat__label">{{ card.label }}</span>
            <span class="stat__value">{{ storeStats[card.key] }}</span>
          </span>
        </button>
      </section>

      <div class="filters">
        <div class="search">
          <span class="search__icon"><AppIcon name="search" :size="16" /></span>
          <input
            v-model="state.storeQuery"
            type="search"
            class="search__input"
            placeholder="搜索名称、作者或关键词"
            aria-label="搜索市场插件"
            @input="scheduleStoreSearch()"
          />
          <button
            v-if="state.storeQuery"
            type="button"
            class="search__clear"
            aria-label="清空搜索"
            @click="clearStoreQuery()"
          >
            <AppIcon name="x" :size="15" />
          </button>
        </div>

        <div
          v-if="authorFacets.length > 1"
          class="facets"
          role="group"
          aria-label="按创作者筛选（在所选来源内）"
        >
          <span class="facets__label">创作者（在所选来源内）</span>
          <button
            type="button"
            class="chip"
            :class="{ 'chip--active': state.storeAuthors.length === 0 }"
            :aria-pressed="state.storeAuthors.length === 0"
            @click="state.storeAuthors = []"
          >
            全部
          </button>
          <button
            v-for="facet in authorFacets"
            :key="facet.author"
            type="button"
            class="chip"
            :class="{ 'chip--active': state.storeAuthors.includes(facet.author) }"
            :aria-pressed="state.storeAuthors.includes(facet.author)"
            :title="facet.author"
            @click="setStoreAuthor(facet.author)"
          >
            <span class="chip__label">{{ facet.author }}</span>
            <span class="chip__count">{{ facet.count }}</span>
          </button>
          <button
            v-if="authorFacetsHidden > 0"
            type="button"
            class="chip chip--ghost"
            :title="`还有 ${authorFacetsHidden} 位作者；作者太多时直接搜名字更快`"
            @click="toggleAuthorFacets()"
          >
            更多作者
          </button>
          <button
            v-else-if="state.authorFacetsExpanded"
            type="button"
            class="chip chip--ghost"
            @click="toggleAuthorFacets()"
          >
            收起作者
          </button>
          <span v-if="authorFacetOverflow" class="facets__hint">
            共 {{ authorFacetTotal }} 位作者，这里只列高产的前几位；找特定作者用搜索
          </span>
          <span v-else-if="state.storeAuthors.length > 1" class="facets__hint">多选取任一命中</span>
        </div>

        <div
          v-if="categoryFacets.length > 1"
          class="facets"
          role="group"
          aria-label="按分类筛选（在所选来源与创作者内）"
        >
          <span class="facets__label">分类（在所选来源与创作者内）</span>
          <button
            type="button"
            class="chip"
            :class="{ 'chip--active': state.storeCategories.length === 0 }"
            :aria-pressed="state.storeCategories.length === 0"
            @click="state.storeCategories = []"
          >
            全部
          </button>
          <button
            v-for="facet in categoryFacets"
            :key="facet.key"
            type="button"
            class="chip"
            :class="{ 'chip--active': state.storeCategories.includes(facet.key) }"
            :aria-pressed="state.storeCategories.includes(facet.key)"
            @click="setStoreCategory(facet.key)"
          >
            <span class="chip__label">{{ MARKET_CATEGORY_LABEL[facet.key] ?? facet.key }}</span>
            <span class="chip__count">{{ facet.count }}</span>
          </button>
          <span v-if="state.storeCategories.length > 1" class="facets__hint">多选取任一命中</span>
        </div>

        <div class="filters__tail">
          <FilterSelect
            v-model="state.storeSort"
            :options="STORE_SORTS"
            prefix="排序"
            leading-icon="arrow-up-down"
            aria-label="插件市场排序方式"
          />
          <button type="button" class="filters__icon-btn" @click="openIndexSource()">
            <AppIcon name="rss" :size="16" />
            索引源
          </button>
          <button
            type="button"
            class="filters__icon-btn"
            :disabled="state.busy.subscribe"
            title="订阅社区索引（条目多，来自第三方站点同步）"
            @click="subscribeCommunityIndex()"
          >
            <span v-if="state.busy.subscribe" class="spinner" />
            <AppIcon v-else name="inbox" :size="16" />
            社区目录
          </button>
          <button
            type="button"
            class="filters__icon-btn"
            :disabled="listLoading('store')"
            aria-label="刷新索引源"
            @click="loadStore(true)"
          >
            <span v-if="listLoading('store')" class="spinner" />
            <AppIcon v-else name="refresh" :size="16" />
            刷新
          </button>
        </div>

        <!-- 生效中的筛选摘要：条件由 state 算出，chip 不在了也要能自证 -->
        <div
          v-if="storeConditions.length"
          class="filter-sum"
          role="group"
          aria-label="生效的筛选条件"
        >
          <span class="filter-sum__label">正在筛选</span>
          <button
            v-for="condition in storeConditions"
            :key="condition.kind"
            type="button"
            class="filter-sum__item"
            :class="{ 'filter-sum__item--warn': condition.warn }"
            :aria-label="`取消${condition.text}`"
            @click="clearStoreCondition(condition.kind)"
          >
            <span class="filter-sum__text">{{ condition.text }}</span>
            <AppIcon name="x" :size="13" />
          </button>
          <span class="filter-sum__arrow">→</span>
          <span class="filter-sum__count">共 {{ visibleStoreCount.toLocaleString('zh-CN') }} 条</span>
          <button type="button" class="filter-sum__clear" @click="clearStoreFilters()">清除全部</button>
        </div>
      </div>

      <!-- 已有列表时保留旧内容，只加一条细进度：几千张卡换成骨架会让页面塌陷、滚动位置丢失 -->
      <p v-if="listLoading('store') && state.market.length > 0" class="store-progress" role="status">
        <span class="spinner" />
        <span>正在读取索引源{{ state.storeProgress ? ` ${state.storeProgress} 个分页` : '…' }}</span>
      </p>

      <div v-if="indexErrorList().length" class="index-errors">
        <div v-for="[url, message] in indexErrorList()" :key="url" class="index-errors__item">
          <AppIcon name="alert-circle" :size="16" />
          <span><span class="mono">{{ hostOf(url) }}</span> 读取失败：{{ message }}</span>
        </div>
      </div>

      <!-- 首次进市场才用骨架屏 -->
      <div v-if="listLoading('store') && state.market.length === 0" class="card-grid">
        <div v-for="n in 6" :key="n" class="skeleton-card" />
      </div>

      <div v-else-if="listError('store') || hostOffline()" class="state-box">
        <span class="state-box__icon"><AppIcon name="alert-circle" :size="40" /></span>
        <span class="state-box__title">{{ hostOffline() ? `没连上 ${HOST.displayName}` : '插件市场加载失败' }}</span>
        <span class="state-box__hint">
          {{
            hostOffline()
              ? `${BRAND.name}要在宿主里打开才有插件数据；npm run dev 只用于调页面样式`
              : '宿主没有返回索引源列表，请稍后重试'
          }}
        </span>
        <button type="button" class="btn btn--secondary state-box__action" @click="loadStore()">
          重试
        </button>
      </div>

      <div v-else-if="!state.indexes.length" class="state-box">
        <span class="state-box__icon"><AppIcon name="inbox" :size="40" /></span>
        <span class="state-box__title">还没有配置索引源</span>
        <span class="state-box__hint">订阅 {{ BRAND.name }} 索引后，这里会列出它收录的插件</span>
        <div class="state-box__actions">
          <button
            type="button"
            class="btn btn--primary"
            :disabled="state.busy.subscribe"
            @click="subscribeSelfIndex()"
          >
            <span v-if="state.busy.subscribe" class="spinner" />
            订阅 {{ BRAND.name }} 索引
          </button>
          <button type="button" class="btn btn--secondary" @click="openIndexSource()">
            查看索引文件
          </button>
        </div>
      </div>

      <!-- 搜索 0 结果：索引有内容，只是没匹配上 -->
      <div v-else-if="storeSearchEmpty()" class="state-box">
        <span class="state-box__icon"><AppIcon name="search" :size="40" /></span>
        <span class="state-box__title">没有匹配「{{ state.storeQuery.trim() }}」的插件</span>
        <span class="state-box__hint">
          已搜索全部 {{ state.storeCorpusTotal.toLocaleString('zh-CN') }} 条
        </span>
        <button type="button" class="btn btn--primary state-box__action" @click="clearStoreFilters()">
          清除搜索
        </button>
      </div>

      <div v-else-if="storeIndexEmpty()" class="state-box">
        <span class="state-box__icon"><AppIcon name="inbox" :size="40" /></span>
        <span class="state-box__title">索引里没有插件</span>
        <span class="state-box__hint">订阅的索引源这次没有返回任何条目，刷新或稍后再看</span>
        <button type="button" class="btn btn--secondary state-box__action" @click="loadStore(true)">
          刷新索引
        </button>
      </div>

      <div v-else-if="noStoreMatch()" class="state-box">
        <span class="state-box__icon"><AppIcon name="search" :size="40" /></span>
        <span class="state-box__title">没有符合当前筛选的插件</span>
        <span class="state-box__hint">按上面的筛选摘要逐项取消，或一次性清空全部条件</span>
        <button type="button" class="btn btn--secondary state-box__action" @click="clearStoreFilters()">
          清除搜索与筛选
        </button>
      </div>

      <div v-else class="store-list" :aria-busy="listLoading('store') ? 'true' : 'false'">
        <p v-if="storeTruncated" class="index-errors__item" role="status">
          <AppIcon name="alert-circle" :size="16" />
          <span>
            索引共 {{ storeTruncated.toLocaleString('zh-CN') }} 个插件，已加载
            {{ state.market.length.toLocaleString('zh-CN') }} 个（达到单次翻页上限）
          </span>
        </p>

        <p v-if="state.market.length > 500" class="store-hint">
          已加载 {{ state.market.length.toLocaleString('zh-CN') }} 个条目：按名称、作者或关键词搜索比翻页快；列表按批渲染，点「显示更多」继续。
        </p>

        <section v-for="group in renderedStoreGroups" :key="group.url" class="store-group">
          <header class="store-group__header">
            <span class="store-group__name">{{ group.title }}</span>
            <span class="store-group__count">{{ group.total.toLocaleString('zh-CN') }}</span>
            <span v-if="group.entries.length < group.total" class="store-group__rendered">
              已渲染 {{ group.entries.length.toLocaleString('zh-CN') }} / 共
              {{ group.total.toLocaleString('zh-CN') }}
            </span>
            <span class="store-group__id">{{ hostOf(group.url) }}</span>
            <span class="store-group__rule" />
            <a
              class="store-group__link"
              :href="group.url"
              target="_blank"
              rel="noopener"
              :aria-label="`打开 ${group.title}`"
            >
              <AppIcon name="external-link" :size="14" />
            </a>
          </header>
          <div class="card-grid" :class="{ 'card-grid--dense': denseStoreCards }">
            <StorePluginCard
              v-for="entry in group.entries"
              :key="`${group.url}${entry.name}`"
              :entry="entry"
              :dense="denseStoreCards"
            />
          </div>
        </section>

        <div v-if="storeHasMore" class="store-more">
          <button type="button" class="btn btn--secondary" @click="showMoreStore()">
            显示更多（共 {{ visibleStoreCount.toLocaleString('zh-CN') }} 个，已显示
            {{ state.storeRenderLimit.toLocaleString('zh-CN') }}）
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.update-notice {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  margin-bottom: 18px;
  border: 1px solid #fde68a;
  border-radius: 12px;
  background: var(--amber-bg);
  color: var(--amber-text);
}

.update-notice__icon {
  display: flex;
  flex: none;
}

.update-notice__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
}

.update-notice__text strong {
  font-size: 14px;
  font-weight: 600;
}

.update-notice__branches {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 5px;
}

.update-notice__branch {
  padding: 2px 8px;
  border: 1px solid #fcd34d;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.55);
  font-size: 12px;
}

.update-notice__actions {
  display: flex;
  gap: 8px;
  flex: none;
}

.state-box__actions {
  display: flex;
  gap: 10px;
  margin-top: 4px;
}

.index-errors {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 18px;
}

.index-errors__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid #fde68a;
  background: var(--amber-bg);
  color: var(--amber-text);
  font-size: 13px;
}
</style>
