/**
 * PlugBox · Host 半边（DeepSeek Harness 适配器的宿主侧实现）。
 *
 * 两个职责：
 * 1. 把随包提交的 `web/`（Vue 构建产物）挂在同源前缀路由 `/plugbox/` 上，
 *    供 Client 半边在侧栏入口里用 iframe 打开；
 * 2. 在同一前缀下提供 `/plugbox/api/rpc`，把页面上的操作转成对该宿主
 *    `pluginManager` / `pluginMarket` 服务的真实调用。
 *
 * 这个文件属于适配层（src/adapters/dsh/）在宿主进程里的那一半：这里的路由前缀、
 * 服务名都是宿主专属知识，核心层不认识它们。换宿主就要照着这份再写一份。
 * 前缀与 src/adapters/dsh 里的 routePrefix 必须保持一致，
 * npm run check:adapters 会盯着这个一致性。
 *
 * 为什么不用 `dsh.bundle` 自带的前端能力：插件中心是既有 Vue 单页应用，
 * 以静态产物 + iframe 的方式复用，避免把 UI 重写成 Client 模块。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = path.join(ROOT, 'web')
const ENTRY = path.join(WEB_ROOT, 'index.html')
const ROUTE = '/plugbox'
const ROUTE_PREFIX = `${ROUTE}/`
const API_ROUTE = `${ROUTE}/api/rpc`
const MAX_BODY_BYTES = 512 * 1024
const execFileAsync = promisify(execFile)

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
])

function sendText(response, status, body) {
  response.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(body)
}

/** 带 hash 的资源可长缓存；入口页与索引必须每次取新。 */
function cacheControl(file) {
  return file.endsWith('.html') || file.endsWith('.json')
    ? 'no-store'
    : 'public, max-age=31536000, immutable'
}

/**
 * 把 URL 路径解析成 `web/` 下的真实文件，越界（`..`、绝对路径、非法转义）一律拒绝。
 */
function resolveTarget(pathname) {
  let relative
  try {
    relative = decodeURIComponent(pathname.slice(ROUTE_PREFIX.length))
  } catch {
    return { kind: 'bad' }
  }
  if (relative.includes('\0')) return { kind: 'bad' }
  const file = path.resolve(WEB_ROOT, relative === '' ? 'index.html' : relative)
  if (file !== WEB_ROOT && !file.startsWith(`${WEB_ROOT}${path.sep}`)) return { kind: 'denied' }
  return { kind: 'file', file }
}

async function serveFile(request, response, file) {
  let stat
  try {
    stat = await fs.promises.stat(file)
  } catch {
    return false
  }
  if (!stat.isFile()) return false
  const type = MIME.get(path.extname(file).toLowerCase()) ?? 'application/octet-stream'
  response.writeHead(200, {
    'content-type': type,
    'content-length': stat.size,
    'cache-control': cacheControl(file),
  })
  if (request.method === 'HEAD') {
    response.end()
    return true
  }
  await new Promise((resolve) => {
    const stream = fs.createReadStream(file)
    stream.on('error', () => {
      response.destroy()
      resolve(undefined)
    })
    stream.on('end', resolve)
    stream.pipe(response)
  })
  return true
}

// ============ 宿主 API：页面操作 → DSH 服务 ============

class ApiError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

/** 只接受同源调用：跨站页面不能借这个路由改插件状态 */
function sameOrigin(request) {
  const site = request.headers['sec-fetch-site']
  if (site === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === request.headers.host
  } catch {
    return false
  }
}

function requireService(ctx, name) {
  const service = ctx.get(name)
  if (service === undefined) {
    throw new ApiError('service-unavailable', `当前 profile 没有装载 ${name} 服务`)
  }
  return service
}

function textParam(params, key) {
  const value = params?.[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ApiError('invalid-params', `缺少参数 ${key}`)
  }
  return value
}

function boolParam(params, key) {
  const value = params?.[key]
  if (typeof value !== 'boolean') throw new ApiError('invalid-params', `参数 ${key} 必须是布尔值`)
  return value
}

// ============ 仓库分支：按分支安装 ============

const REPO_SLUG = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/
const BRANCH_CACHE_TTL_MS = 60_000
const branchCache = new Map()

/**
 * 列分支优先走 `git ls-remote --heads`：GitHub 的 REST 接口未登录只有 60 次/小时，
 * 装几次插件就可能被限流；ls-remote 不受此限，也不依赖 token。
 * git 不可用时退回 REST 接口，让功能不至于整块失效。
 */
async function branchesByGit(repo) {
  const { stdout } = await execFileAsync(
    'git',
    ['ls-remote', '--heads', `https://github.com/${repo}`],
    {
      timeout: 20_000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    },
  )
  const branches = []
  for (const line of stdout.split('\n')) {
    const [sha, ref] = line.trim().split('\t')
    if (!ref?.startsWith('refs/heads/')) continue
    branches.push({ name: ref.slice('refs/heads/'.length), commit: sha })
  }
  return branches
}

async function branchesByApi(repo) {
  const response = await fetch(`https://api.github.com/repos/${repo}/branches?per_page=100`, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'PlugBox-PluginCenter',
      'x-github-api-version': '2022-11-28',
    },
    signal: AbortSignal.timeout(15_000),
  })
  if (response.status === 403 || response.status === 429) {
    throw new ApiError('github-rate-limited', 'GitHub 接口限流了，过几分钟再试')
  }
  if (response.status === 404) throw new ApiError('repo-unavailable', `找不到仓库 ${repo}`)
  if (!response.ok) throw new ApiError('github-unavailable', `GitHub 返回 ${response.status}`)
  const list = await response.json()
  if (!Array.isArray(list)) throw new ApiError('github-unavailable', 'GitHub 返回了意外的结构')
  return list.map((item) => ({ name: item.name, commit: item.commit?.sha }))
}

/** package.json 里的展示字段可能是字符串或 { zh, en } 映射，统一取一条文本 */
function textOf(value) {
  if (typeof value === 'string') return value.trim() === '' ? null : value
  if (typeof value === 'object' && value !== null) {
    for (const key of ['zh', 'en']) {
      if (typeof value[key] === 'string' && value[key].trim() !== '') return value[key]
    }
    const first = Object.values(value).find((item) => typeof item === 'string' && item.trim() !== '')
    return first ?? null
  }
  return null
}

/** 读某个分支上的 package.json：版本号、engines.dsh、是否声明了组合包、展示文案 */
async function branchManifest(repo, ref, packagePath) {
  const location = [ref, ...packagePath.split('/').filter(Boolean)].map(encodeURIComponent).join('/')
  try {
    const response = await fetch(`https://raw.githubusercontent.com/${repo}/${location}/package.json`, {
      signal: AbortSignal.timeout(15_000),
    })
    if (response.status === 404) return undefined
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const manifest = await response.json()
    if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
      throw new Error('package.json 不是对象')
    }
    return manifest
  } catch (error) {
    throw new ApiError('github-unavailable', `读取 ${repo}/${packagePath || '.'} 的 package.json 失败：${error.message}`)
  }
}

/** 与索引的 source.path 相同：相对包目录，不接受 URL 参数、编码穿越或空路径。 */
function packagePathOf(value) {
  if (value === undefined) return ''
  if (typeof value !== 'string' || value.length > 1024 || value.split('/').some(
    (segment) => segment === '.' || segment === '..' || !/^[A-Za-z0-9._@+-]+$/.test(segment),
  )) {
    throw new ApiError('invalid-params', 'path 必须是仓库内的相对包目录')
  }
  return value
}

async function readRepoBranches(repo, packagePath, refresh) {
  if (!REPO_SLUG.test(repo)) {
    throw new ApiError('invalid-params', '仓库名必须是 owner/name 形式')
  }
  const cacheKey = JSON.stringify([repo, packagePath])
  const cached = branchCache.get(cacheKey)
  if (!refresh && cached !== undefined && Date.now() - cached.at < BRANCH_CACHE_TTL_MS) return cached.value

  let listed
  try {
    listed = await branchesByGit(repo)
  } catch (error) {
    // 仓库不存在 / 无权限时 git 的报错是准的，别再拿 REST 接口的限流结果覆盖它
    const stderr = String(error?.stderr ?? error?.message ?? '')
    if (/not found|does not exist|could not read Username|Authentication failed/i.test(stderr)) {
      throw new ApiError('repo-unavailable', `找不到仓库 ${repo}，或它需要授权才能读`)
    }
    listed = await branchesByApi(repo)
  }
  if (listed.length === 0) throw new ApiError('repo-unavailable', `仓库 ${repo} 没有可读的分支`)

  const branches = await Promise.all(
    listed.map(async (branch) => {
      // 固定到本次 ls-remote 的提交，避免分支名带斜杠或扫描途中被推进时读错清单。
      const manifest = await branchManifest(repo, branch.commit ?? branch.name, packagePath)
      return {
        name: branch.name,
        commit: branch.commit ?? null,
        version: typeof manifest?.version === 'string' ? manifest.version : null,
        enginesDsh: typeof manifest?.engines?.dsh === 'string' ? manifest.engines.dsh : null,
        bundle: manifest?.dsh?.bundle !== undefined && manifest.dsh.bundle !== null,
        title: textOf(manifest?.dsh?.meta?.title),
        // 分支之间的描述可能不一样，装之前得看得见差别
        description: textOf(manifest?.dsh?.meta?.description) ?? textOf(manifest?.description),
      }
    }),
  )
  branches.sort((a, b) => a.name.localeCompare(b.name))

  const value = { repo, branches }
  if (branchCache.size >= 128) branchCache.delete(branchCache.keys().next().value)
  branchCache.set(cacheKey, { at: Date.now(), value })
  return value
}

const API_METHODS = {
  status(ctx) {
    return {
      pluginManager: ctx.get('pluginManager') !== undefined,
      pluginMarket: ctx.get('pluginMarket') !== undefined,
    }
  },
  listBundles(ctx) {
    return requireService(ctx, 'pluginManager').listBundles()
  },
  listPlugins(ctx) {
    return requireService(ctx, 'pluginManager').listPlugins()
  },
  setBundleEnabled(ctx, params) {
    return requireService(ctx, 'pluginManager').setBundleEnabled(
      textParam(params, 'name'),
      boolParam(params, 'enabled'),
    )
  },
  setPluginEnabled(ctx, params) {
    return requireService(ctx, 'pluginManager').setPluginEnabled(
      textParam(params, 'entryId'),
      boolParam(params, 'enabled'),
    )
  },
  removeBundle(ctx, params) {
    return requireService(ctx, 'pluginManager').removeBundle(textParam(params, 'name'))
  },
  installBundle(ctx, params) {
    const spec = textParam(params, 'spec')
    const options = {}
    if (typeof params.registry === 'string') options.registry = params.registry
    else if (params.registry === null) options.registry = null
    if (Array.isArray(params.approvedBuilds)) options.approvedBuilds = params.approvedBuilds
    return requireService(ctx, 'pluginManager').installBundle(spec, options)
  },
  listIndexes(ctx) {
    return requireService(ctx, 'pluginMarket').listIndexes()
  },
  async setIndexes(ctx, params) {
    const urls = params?.urls
    if (!Array.isArray(urls) || urls.some((url) => typeof url !== 'string')) {
      throw new ApiError('invalid-params', '参数 urls 必须是字符串数组')
    }
    await requireService(ctx, 'pluginMarket').setIndexes(urls)
    return null
  },
  searchMarket(ctx, params) {
    const url = textParam(params, 'url')
    const query = params?.query
    if (typeof query !== 'object' || query === null) {
      throw new ApiError('invalid-params', '参数 query 必须是对象')
    }
    return requireService(ctx, 'pluginMarket').search(url, {
      ...query,
      limit: Math.min(Math.max(Number(query.limit) || 50, 1), 100),
      offset: Math.max(Number(query.offset) || 0, 0),
    })
  },
  repoBranches(ctx, params) {
    return readRepoBranches(
      textParam(params, 'repo'),
      packagePathOf(params.path),
      params.refresh === undefined ? false : boolParam(params, 'refresh'),
    )
  },
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new ApiError('body-too-large', '请求体过大'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve(raw === '' ? {} : JSON.parse(raw))
      } catch {
        reject(new ApiError('invalid-json', '请求体不是合法 JSON'))
      }
    })
    request.on('error', reject)
  })
}

async function handleApi(request, response, ctx) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { ok: false, error: { code: 'method-not-allowed', message: '只接受 POST' } })
    return
  }
  if (!sameOrigin(request)) {
    sendJson(response, 403, { ok: false, error: { code: 'cross-origin', message: '只允许同源调用' } })
    return
  }

  let body
  try {
    body = await readBody(request)
  } catch (error) {
    const code = error instanceof ApiError ? error.code : 'invalid-json'
    sendJson(response, 400, { ok: false, error: { code, message: error.message } })
    return
  }

  const method = API_METHODS[body?.method]
  if (method === undefined) {
    sendJson(response, 400, { ok: false, error: { code: 'unknown-method', message: '未知的调用' } })
    return
  }

  // 安装与卸载会跑 pnpm，可能持续数分钟，先摘掉这条连接的空闲超时。
  request.setTimeout?.(0)
  response.setTimeout?.(0)

  try {
    const result = await method(ctx, body.params ?? {})
    sendJson(response, 200, { ok: true, result: result ?? null })
  } catch (error) {
    const code = error instanceof ApiError ? error.code : error?.code ?? 'operation-error'
    const message = error instanceof Error ? error.message : String(error)
    sendJson(response, code === 'service-unavailable' ? 503 : 400, {
      ok: false,
      error: { code, message, diagnostic: message },
    })
  }
}

async function handler(request, response, ctx) {
  let pathname
  try {
    pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
  } catch {
    sendText(response, 400, 'Bad Request')
    return
  }

  if (pathname === API_ROUTE) {
    await handleApi(request, response, ctx)
    return
  }

  const method = request.method ?? 'GET'
  if (method !== 'GET' && method !== 'HEAD') {
    sendText(response, 405, 'Method Not Allowed')
    return
  }

  // 少了尾斜杠时相对资源会解析到站点根目录，必须补上。
  if (pathname === ROUTE) {
    response.writeHead(308, { location: ROUTE_PREFIX, 'cache-control': 'no-store' })
    response.end()
    return
  }
  if (!pathname.startsWith(ROUTE_PREFIX)) {
    sendText(response, 404, 'Not Found')
    return
  }

  const target = resolveTarget(pathname)
  if (target.kind === 'bad') {
    sendText(response, 400, 'Bad Request')
    return
  }
  if (target.kind === 'denied') {
    sendText(response, 403, 'Forbidden')
    return
  }

  if (await serveFile(request, response, target.file)) return

  // 未构建：给出可执行的修复提示，而不是让面板空白。
  if (!fs.existsSync(ENTRY)) {
    sendText(
      response,
      503,
      '插件中心前端未构建：本包内缺少 web/index.html。\n' +
        '请在本仓库运行 npm run build（web/ 随包提交），然后重启宿主窗口。\n',
    )
    return
  }

  // 无扩展名的路径回落到入口页，便于以后加前端路由。
  if (!path.extname(target.file) && (await serveFile(request, response, ENTRY))) return

  sendText(response, 404, 'Not Found')
}

export function apply(ctx) {
  ctx.inject(['webServer'], (scoped) => {
    scoped.effect(
      () =>
        scoped.webServer.register({
          kind: 'prefix',
          path: ROUTE,
          handler: (request, response) => {
            handler(request, response, ctx).catch((error) => {
              if (!response.headersSent) sendText(response, 500, 'Internal Server Error')
              else response.destroy()
              console.error('[plugbox] 路由处理失败：', error)
            })
          },
        }),
      'plugbox:web-route',
    )
  })
}
