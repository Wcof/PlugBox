/**
 * scan-author.mjs 的打包入口：把 core 的版本比较聚成单文件供 node 加载。
 * 判定逻辑仍只在 src/core，这里只做转发。
 */
export { compareVersions } from '../src/core/protocol/version'
