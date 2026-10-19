export interface ImageData {
  mime: string
  base64: string
}

export interface ConvertOptions {
  /** 笔记文件名，没有 title 字段时用来做标题 */
  fileName: string
  /** 按笔记里写的引用读取库内图片；读不到、太大或不是图片时返回 null */
  readImage: (ref: string) => Promise<ImageData | null>
}

export interface ConvertResult {
  title: string
  markdown: string
  warnings: string[]
}

/** 空 frontmatter（`---` 紧跟 `---`）单独成一支，避免非贪婪分组一路吃到正文里的分隔线 */
export const FRONTMATTER = /^---[ \t]*\n(?:---|([\s\S]*?)\n---)[ \t]*(?:\n|$)/
export const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|svg|bmp)$/i
export const NUMERIC_SIZE = /^\d+(?:x\d+)?$/
/** 围栏代码块，或行内代码 */
const CODE = /^(`{3,}(?!`)|~{3,}(?!~))[^\n]*\n[\s\S]*?^\1[ \t]*$|`[^`\n]+`/gm
export const EMBED = /!\[\[([^\]|\n]+)(?:\|([^\]\n]*))?\]\]/g
export const MD_IMAGE = /!\[([^\]\n]*)\]\((?!https?:|data:|\/\/)([^)\s]+)\)/g
const WIKILINK = /!?\[\[([^\]|#^\n]+)(?:[#^][^\]|\n]*)?(?:\|([^\]\n]*))?\]\]/g
const COMMENT = /%%[\s\S]*?%%/g
const CALLOUT = /^([ \t]*(?:>[ \t]*)+)\[!([\w-]+)\][+-]?(.*)$/gm

export function unquote(text: string): string {
  return text.replace(/^(["'])(.*)\1$/, `$2`)
}

function splitFrontmatter(raw: string): { title: string | null, body: string } {
  const match = FRONTMATTER.exec(raw)
  if (!match)
    return { title: null, body: raw }
  const line = /^title:(.*)$/m.exec(match[1] ?? ``)
  return { title: line ? unquote(line[1].trim()) : null, body: raw.slice(match[0].length) }
}

export async function replaceAsync(text: string, pattern: RegExp, replacer: (match: RegExpExecArray) => Promise<string>): Promise<string> {
  let result = ``
  let last = 0
  for (const match of text.matchAll(pattern)) {
    result += text.slice(last, match.index) + await replacer(match)
    last = match.index + match[0].length
  }
  return result + text.slice(last)
}

/** 只对代码以外的片段做转换 */
export async function mapOutsideCode(text: string, transform: (segment: string) => Promise<string>): Promise<string> {
  let result = ``
  let last = 0
  for (const match of text.matchAll(CODE)) {
    result += await transform(text.slice(last, match.index)) + match[0]
    last = match.index + match[0].length
  }
  return result + await transform(text.slice(last))
}

export function baseName(ref: string): string {
  const name = ref.split(`/`).pop() ?? ref
  return name.replace(/\.[^.]+$/, ``)
}

export function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text)
  }
  catch {
    return text
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export async function convertNote(raw: string, options: ConvertOptions): Promise<ConvertResult> {
  const warnings: string[] = []
  const { title: frontmatterTitle, body } = splitFrontmatter(raw.replace(/\r\n/g, `\n`))

  async function inlineImage(ref: string, alt: string): Promise<string> {
    const data = await options.readImage(ref)
    if (!data) {
      warnings.push(`图片未载入：${ref}`)
      return `（图片未载入：${ref}）`
    }
    return `![${alt}](data:${data.mime};base64,${data.base64})`
  }

  const markdown = await mapOutsideCode(body, async (segment) => {
    let text = segment.replace(COMMENT, ``)
    text = await replaceAsync(text, EMBED, async (match) => {
      const ref = match[1].trim()
      if (!IMAGE_EXT.test(ref))
        return match[0]
      const alias = match[2]?.trim()
      const alt = alias && !NUMERIC_SIZE.test(alias) ? alias : baseName(ref)
      return inlineImage(ref, alt)
    })
    text = await replaceAsync(text, MD_IMAGE, match => inlineImage(safeDecode(match[2]), match[1]))
    text = text.replace(WIKILINK, (_all, name: string, alias?: string) => (alias?.trim() || (name.trim().split(`/`).pop() ?? name)))
    return text.replace(CALLOUT, (_all, prefix: string, type: string, title: string) =>
      `${prefix}**${title.trim() || capitalize(type)}**\n${prefix.trimEnd()}`)
  })

  const fallbackTitle = options.fileName.replace(/\.md$/i, ``)
  return {
    title: frontmatterTitle || fallbackTitle,
    markdown: markdown.replace(/^\n+/, ``),
    warnings,
  }
}
