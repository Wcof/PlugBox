/**
 * 开发指南弹窗里渲染项目自带文档的极简 Markdown 渲染器。
 *
 * 只覆盖 README.md 与 docs/hosts/dsh-spec.md 实际用到的语法：标题、段落、
 * 列表、引用、表格、围栏代码块、分隔线与行内标记。不引第三方解析器——
 * 这两份文档是构建期用 ?raw 打进产物的本地内容，够用且离线可读。
 *
 * 安全：正文先整体转义 HTML；只有 http(s) 链接会生成 <a>，仓库内的相对链接
 * 在面板里点不开，退化成纯文字，避免把用户带到一个 404 的宿主路由上。
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const CODE_SLOT = '\u0000'

/** 行内标记：`代码`、**粗体**、*斜体*、[文字](链接)、<https://…> */
export function renderInline(text: string): string {
  const codes: string[] = []
  let out = escapeHtml(text)

  // 行内代码先占位，里面的 * 和 [] 不该被后续规则改写
  out = out.replace(/`([^`]+)`/g, (_match, code: string) => {
    codes.push(`<code>${code}</code>`)
    return `${CODE_SLOT}${codes.length - 1}${CODE_SLOT}`
  })
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, href: string) =>
    /^https?:\/\//i.test(href)
      ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`
      : label,
  )
  out = out.replace(/&lt;(https?:\/\/[^&\s]+)&gt;/g, (_match, url: string) =>
    `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`,
  )
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  out = out.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => codes[Number(index)] ?? '')
  return out
}

function cellsOf(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim())
}

function isTableDivider(line: string): boolean {
  if (!line.includes('-') || !line.includes('|')) return false
  return cellsOf(line).every((cell) => /^:?-{3,}:?$/.test(cell))
}

/** 段落遇到块级起点就收尾，否则会把标题、列表吞进同一个 <p> */
function isBlockStart(lines: string[], index: number): boolean {
  const line = lines[index]
  if (line === undefined) return false
  return (
    /^\s*```/.test(line) ||
    /^#{1,6}\s+/.test(line) ||
    /^\s*[-*+]\s+/.test(line) ||
    /^\s*\d+\.\s+/.test(line) ||
    /^\s*>\s?/.test(line) ||
    /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line) ||
    (line.trim().startsWith('|') && isTableDivider(lines[index + 1] ?? ''))
  )
}

export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // 围栏代码块
    if (/^\s*```/.test(line)) {
      const lang = line.trim().slice(3).trim()
      const body: string[] = []
      i += 1
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        body.push(lines[i])
        i += 1
      }
      i += 1
      const cls = lang === '' ? '' : ` class="language-${escapeHtml(lang)}"`
      out.push(`<pre><code${cls}>${escapeHtml(body.join('\n'))}</code></pre>`)
      continue
    }

    if (line.trim() === '') {
      i += 1
      continue
    }

    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push('<hr>')
      i += 1
      continue
    }

    // 表格：表头下一行必须是 |---|---| 这类分隔行
    if (line.trim().startsWith('|') && isTableDivider(lines[i + 1] ?? '')) {
      const head = cellsOf(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(cellsOf(lines[i]))
        i += 1
      }
      const headHtml = head.map((cell) => `<th>${renderInline(cell)}</th>`).join('')
      const bodyHtml = rows
        .map(
          (row) =>
            `<tr>${head.map((_, col) => `<td>${renderInline(row[col] ?? '')}</td>`).join('')}</tr>`,
        )
        .join('')
      out.push(
        `<div class="md-table"><table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`,
      )
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading !== null) {
      const level = heading[1].length
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`)
      i += 1
      continue
    }

    if (/^\s*>\s?/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ''))
        i += 1
      }
      out.push(`<blockquote>${body.map(renderInline).join('<br>')}</blockquote>`)
      continue
    }

    if (/^\s*(?:[-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line)
      const tag = ordered ? 'ol' : 'ul'
      const items: string[] = []
      while (i < lines.length && /^\s*(?:[-*+]|\d+\.)\s+/.test(lines[i])) {
        const text = lines[i].replace(/^\s*(?:[-*+]|\d+\.)\s+/, '')
        const nested = /^\s{2,}/.test(lines[i]) ? ' class="md-li--sub"' : ''
        items.push(`<li${nested}>${renderInline(text)}</li>`)
        i += 1
      }
      out.push(`<${tag}>${items.join('')}</${tag}>`)
      continue
    }

    // 普通段落：连续行合并，换行按 Markdown 语义折成空格
    const paragraph = [line.trim()]
    i += 1
    while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines, i)) {
      paragraph.push(lines[i].trim())
      i += 1
    }
    out.push(`<p>${renderInline(paragraph.join(' '))}</p>`)
  }

  return out.join('\n')
}
