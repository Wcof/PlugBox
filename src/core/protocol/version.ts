/**
 * 版本工具。只实现「数字分段比较」这一件所有宿主都认的事；
 * semver 的范围语法是否支持 prerelease 之类的细节由适配器自决。
 *
 * 优先级遵循 SemVer 2.0.0：逐段数字比较之外，无 prerelease 高于有 prerelease，
 * prerelease 标识符数字按数值、字母按字典序、数字低于字母、忽略 build 元数据。
 * 检查更新依赖这套顺序：装的是 0.2.2-rc.1、上游发布 0.2.2 时必须报出更新。
 */

/** 去掉 build 元数据，拆出主版本段与 prerelease 段（如有） */
function splitVersion(version: string): { release: string; prerelease?: string } {
  const withoutBuild = version.includes('+') ? version.slice(0, version.indexOf('+')) : version
  const at = withoutBuild.indexOf('-')
  if (at === -1) return { release: withoutBuild }
  return { release: withoutBuild.slice(0, at), prerelease: withoutBuild.slice(at + 1) }
}

/** prerelease 逐标识符比较：数字按数值、字母按字典序、数字低于字母；短的一方更小 */
function comparePrerelease(a: string, b: string): number {
  const left = a.split('.')
  const right = b.split('.')
  const len = Math.max(left.length, right.length)
  for (let i = 0; i < len; i++) {
    const x = left[i]
    const y = right[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xNumeric = /^\d+$/.test(x)
    const yNumeric = /^\d+$/.test(y)
    if (xNumeric && yNumeric) {
      const d = Number(x) - Number(y)
      if (d !== 0) return d > 0 ? 1 : -1
    } else if (xNumeric !== yNumeric) {
      return xNumeric ? -1 : 1
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  return 0
}

/** 逐段比较版本号：1 表示 a 更新，-1 表示 b 更新，0 表示同版本 */
export function compareVersions(a: string, b: string): number {
  const left = splitVersion(a)
  const right = splitVersion(b)
  const pa = left.release.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = right.release.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  if (left.prerelease === undefined && right.prerelease === undefined) return 0
  if (left.prerelease === undefined) return 1
  if (right.prerelease === undefined) return -1
  return comparePrerelease(left.prerelease, right.prerelease)
}

/**
 * 兼容判定结果：'unknown' 是诚实答案——宿主没告诉核心它的语义库怎么用，
 * 宁可不标注也不能瞎说「兼容」。
 */
export type Compatibility = 'compatible' | 'incompatible' | 'unknown'

export function compatibilityOf(
  satisfies: ((range: string, runtime: string) => boolean) | undefined,
  range: string | undefined,
  runtime: string | undefined,
): Compatibility {
  if (range === undefined || runtime === undefined) return 'unknown'
  if (satisfies === undefined) return 'unknown'
  try {
    return satisfies(range, runtime) ? 'compatible' : 'incompatible'
  } catch {
    return 'unknown'
  }
}
