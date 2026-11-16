/**
 * 索引源读取的健康判定（宿主无关，可被 Node 断言脚本直接引用）。
 *
 * 真实故障：本地代理（TUN / 透明代理）会把到 raw.githubusercontent.com 的连接直接 RST，
 * 宿主侧表现为 `Could not fetch ...: fetch failed: read ECONNRESET`。
 * 这类失败值得重试；404、索引格式错误、宿主服务缺失，重试多少次都是同一个结果。
 */

/** 重试前的等待：两次尝试之间的总代价控制在 1 秒左右 */
export const INDEX_RETRY_DELAYS_MS = [300, 700]

const TRANSIENT_NETWORK =
  /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|EAI_AGAIN|ENETUNREACH|socket hang up|fetch failed|Could not fetch|network error|timed? ?out/i

/** 客户端错误不重试：先判它，免得被统一的 Could not fetch 误伤 */
const HTTP_CLIENT_ERROR = /\b(400|401|403|404|405|410|422)\b/

/** 这次索引读取失败是不是「再试一次可能就好」的网络故障 */
export function isTransientIndexFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  if (HTTP_CLIENT_ERROR.test(message)) return false
  return TRANSIENT_NETWORK.test(message)
}

/**
 * raw 直链对应的 jsDelivr 镜像：源站被重置时，用户至少有一个等价地址可换。
 *
 * 只转 `raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>` 这一种形状。
 * ref 只认单段：带斜杠的分支名（如 `feature/x`）与路径无法从 URL 上区分，
 * 第三段会被当成 ref——对 main / master / tag / commit 这些常见形状是对的，
 * 多段 ref 会得到一个不存在的镜像地址（只影响提示文本，不会自动切换源）。
 */
export function mirrorOf(url: string): string | null {
  const match = /^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/.exec(url)
  return match === null
    ? null
    : `https://cdn.jsdelivr.net/gh/${match[1]}/${match[2]}@${match[3]}/${match[4]}`
}

/** 网络类失败的统一文案：说清发生了什么、已重试几次、还能怎么绕 */
export function describeTransientIndexFailure(
  cause: string,
  mirror: string | null,
  retries: number,
): string {
  return [
    `网络连接被中断，已重试 ${retries} 次${cause ? `（${cause}）` : ''}`,
    '多半是本地代理或网络抖动',
    mirror === null ? '' : `可改用镜像 ${mirror}`,
  ]
    .filter(Boolean)
    .join('；')
}
