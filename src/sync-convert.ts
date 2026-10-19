import type { ConvertOptions } from './convert'
import { baseName, EMBED, FRONTMATTER, IMAGE_EXT, mapOutsideCode, MD_IMAGE, NUMERIC_SIZE, replaceAsync, safeDecode, unquote } from './convert'

/** 还原所需的全部信息：写回时用它把墨笔里的正文接回原笔记 */
export interface SyncParts {
  /** frontmatter 原文（含结尾换行），没有则为空串 */
  head: string
  eol: `\n` | `\r\n`
  /** 令牌 → 原文片段 */
  table: Record<string, string>
}

export interface SyncPrepared {
  title: string
  markdown: string
  /** 令牌 → data URI */
  assets: Record<string, string>
  parts: SyncParts
  warnings: string[]
}

export type SyncUnsupportedReason = `mixed_eol` | `token_collision`
export type PrepareResult = ({ ok: true } & SyncPrepared) | { ok: false, reason: SyncUnsupportedReason }

export const UNSUPPORTED_TEXT: Record<SyncUnsupportedReason, string> = {
  mixed_eol: `这篇笔记同时用了 CRLF 和 LF 两种换行，无法保证逐字还原`,
  token_collision: `这篇笔记正文里有字面的 mobi-asset: 写法，会和图片令牌混淆`,
}

const TOKEN_PREFIX = `mobi-asset:`
const TOKEN_IN_MARKDOWN = /!\[[^\]\n]*\]\((mobi-asset:[0-9a-f]{8}(?:-\d+)?)\)/g

/** FNV-1a 32 位，同步、无依赖；只用来给图片原文取一个稳定的短名字 */
function fnv1a(text: string): string {
  let hash = 0x811C9DC5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, `0`)
}

function tokenFor(original: string, table: Record<string, string>): string {
  const base = `mobi-asset:${fnv1a(original)}`
  let token = base
  for (let n = 1; table[token] !== undefined && table[token] !== original; n++)
    token = `${base}-${n}`
  return token
}

export async function prepareSync(raw: string, options: ConvertOptions): Promise<PrepareResult> {
  const hasCrlf = raw.includes(`\r\n`)
  if (hasCrlf && /(?:^|[^\r])\n/.test(raw))
    return { ok: false, reason: `mixed_eol` }
  const eol = hasCrlf ? `\r\n` : `\n`
  const text = hasCrlf ? raw.replace(/\r\n/g, `\n`) : raw

  const match = FRONTMATTER.exec(text)
  const head = match ? match[0] : ``
  const titleLine = match ? /^title:(.*)$/m.exec(match[1] ?? ``) : null
  const body = text.slice(head.length)
  if (body.includes(`mobi-asset:`))
    return { ok: false, reason: `token_collision` }

  const table: Record<string, string> = {}
  const assets: Record<string, string> = {}
  const warnings: string[] = []

  async function tokenize(original: string, ref: string, alt: string): Promise<string> {
    const data = await options.readImage(ref)
    if (!data) {
      warnings.push(`图片未载入：${ref}`)
      return original
    }
    const token = tokenFor(original, table)
    table[token] = original
    // 媒体类型参数 mobi=<令牌> 让每个令牌的 data URI 唯一：两张数据相同、原文写法不同的图，墨笔侧才能按 URI 压缩回各自的令牌
    assets[token] = `data:${data.mime};mobi=${token.slice(TOKEN_PREFIX.length)};base64,${data.base64}`
    return `![${alt}](${token})`
  }

  const markdown = await mapOutsideCode(body, async (segment) => {
    // 先处理 ![](相对路径)，再处理 ![[嵌入]]：反过来的话，第二遍会把刚生成的令牌图片当成相对路径再处理一次
    const result = await replaceAsync(segment, MD_IMAGE, m => tokenize(m[0], safeDecode(m[2]), m[1]))
    return replaceAsync(result, EMBED, async (m) => {
      const ref = m[1].trim()
      if (!IMAGE_EXT.test(ref))
        return m[0]
      const alias = m[2]?.trim()
      return tokenize(m[0], ref, alias && !NUMERIC_SIZE.test(alias) ? alias : baseName(ref))
    })
  })

  const fallbackTitle = options.fileName.replace(/\.md$/i, ``)
  return {
    ok: true,
    title: (titleLine ? unquote(titleLine[1].trim()) : ``) || fallbackTitle,
    markdown,
    assets,
    parts: { head, eol, table },
    warnings,
  }
}

/** 把墨笔里的正文接回原笔记：令牌换回原写法，接上 frontmatter，恢复换行风格 */
export function restoreSync(markdown: string, parts: SyncParts): string {
  const body = markdown.replace(/\r\n/g, `\n`).replace(TOKEN_IN_MARKDOWN, (all, token: string) => parts.table[token] ?? all)
  const text = parts.head + body
  return parts.eol === `\r\n` ? text.replace(/\n/g, `\r\n`) : text
}

/** 笔记在 Obsidian 里被改后重新准备：令牌表取并集，让墨笔里还没同步的旧内容仍能还原 */
export function mergeParts(previous: SyncParts | null, next: SyncParts): SyncParts {
  if (!previous)
    return next
  return { head: next.head, eol: next.eol, table: { ...previous.table, ...next.table } }
}
