/**
 * check-update-detection.mjs 的打包入口：把 core 里的纯函数聚成单文件供 node 加载。
 * 判定逻辑全部在 src/core，这里只做转发，不写任何规则。
 */
export { compareVersions } from '../src/core/protocol/version'
export { baselineFromScan, diffBranches } from '../src/core/lifecycle/branch-diff'
