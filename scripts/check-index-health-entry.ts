/**
 * check-index-health.mjs 的打包入口：把 core 里的纯判定聚成单文件供 node 加载。
 * 规则全部在 src/core/protocol/indexHealth.ts，这里只做转发。
 */
export {
  INDEX_RETRY_DELAYS_MS,
  describeTransientIndexFailure,
  isTransientIndexFailure,
  mirrorOf,
} from '../src/core/protocol/indexHealth'
