/**
 * 安装 / 更新失败的原因归类，宿主无关的纯函数。
 *
 * 宿主把 pnpm 的原始报错原样透上来（`ERR_PNPM_EIO …`、`ERR_PNPM_FETCH_TIMEOUT …`），
 * 用户看到的是天书，也不指导下一步。这里只做一件事：把已知故障模式翻成
 * 「发生了什么 + 该怎么做」，认不出来的保持原样——宁可露出原文，也不编一个假原因。
 *
 * 判定依据是 pnpm / Node / git 的稳定错误码与措辞，不是猜。
 */

export interface InstallFailureHint {
  /** 归类后的原因，一句话 */
  summary: string
  /** 下一步建议；没有明确建议时省略 */
  hint?: string
  /** 命中的类别，便于日志与断言 */
  kind: 'network' | 'write' | 'lockfile' | 'git-missing'
}

/** 下载阶段：pnpm 拉 tarball / 元数据，或 git 传输被中断 */
const NETWORK = new RegExp(
  [
    'ERR_PNPM_FETCH_TIMEOUT',
    'ERR_PNPM_META_FETCH_FAIL',
    'ECONNRESET',
    'ETIMEDOUT',
    'EAI_AGAIN',
    'ENOTFOUND',
    'socket hang up',
    'fetch failed',
    'Could not fetch',
    'SSL_ERROR_SYSCALL',
    'codeload\\.github\\.com',
    'timed? ?out',
  ].join('|'),
  'i',
)

/**
 * 落盘阶段：pnpm 已经把旧包删掉、却写不成新包。
 * 真实案例：更新插件中心自己时宿主仍在读 `node_modules/plugbox`，
 * pnpm 报 `ERR_PNPM_EIO [importPackage …] No such file or directory`，profile 停在半坏状态。
 */
const WRITE = /\bERR_PNPM_EIO\b|\bEIO\b|ENOTEMPTY|\bEBUSY\b|\bEPERM\b|\bEACCES\b|No such file or directory/i

/** 依赖树与锁文件对不上（多次安装并发、或锁文件被外部改过） */
const LOCKFILE = /ERR_PNPM_LOCKFILE|lockfile.*(mismatch|outdated)|cannot install with.*lockfile/i

/** GitHub 来源的包需要 git 可执行文件 */
const GIT_MISSING = /spawn git|git.*(not found|ENOENT)/i

/**
 * 归类一条安装失败信息；认不出来返回 null，调用方原样展示。
 * 网络优先于落盘：`codeload` 超时后 pnpm 也可能补一句路径错误，先给网络结论更接近事实。
 */
export function explainInstallFailure(message: string): InstallFailureHint | null {
  const raw = message.trim()
  if (raw === '') return null
  if (NETWORK.test(raw)) {
    return {
      summary: '下载插件包超时或连接被中断',
      hint: '多为网络或代理问题，直接重试；反复失败可换网络，或检查代理里 github.com / codeload.github.com 走哪个节点',
      kind: 'network',
    }
  }
  if (WRITE.test(raw)) {
    return {
      summary: '写入插件目录失败',
      hint: '多半是宿主仍占用该目录：退出 DSH 后重试，或先卸载该插件再重新安装',
      kind: 'write',
    }
  }
  if (LOCKFILE.test(raw)) {
    return {
      summary: '依赖锁文件与当前依赖树不一致',
      hint: '重试一次；仍失败说明有另一个安装过程在写同一个 profile，退出宿主后再装',
      kind: 'lockfile',
    }
  }
  if (GIT_MISSING.test(raw)) {
    return {
      summary: '找不到 git 命令',
      hint: 'GitHub 来源的插件需要 git：装好 git 后重试',
      kind: 'git-missing',
    }
  }
  return null
}
