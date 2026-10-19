/**
 * 墨笔与 Obsidian 插件之间的消息协议（protocol 1）。
 * 两端共用这一个文件：插件在 iframe 外，墨笔网页在 iframe 内，靠 postMessage 通信。
 */

export const OBSIDIAN_SOURCE = `mobi-obsidian` as const
export const OBSIDIAN_PROTOCOL = 1 as const

/** 协议版本不一致时，两端互相报告用的错误码 */
export const PROTOCOL_MISMATCH_CODE = `protocol_mismatch`

/** Obsidian 桌面端宿主页面的来源；墨笔侧只接受来自这个来源的消息 */
export const OBSIDIAN_HOST_ORIGIN = `app://obsidian.md`

/** 在线版墨笔的来源；插件侧只接受这个来源的消息 */
export const MOBI_ONLINE_ORIGIN = `https://mobieditor.cn`
export const MOBI_ONLINE_URL = `https://mobieditor.cn/`

interface Envelope<T extends string> {
  source: typeof OBSIDIAN_SOURCE
  protocol: typeof OBSIDIAN_PROTOCOL
  type: T
}

/** 墨笔页面加载完成，可以接收 init */
export interface ReadyMessage extends Envelope<`ready`> {
  appVersion: string
}

/** 墨笔侧的错误报告 */
export interface ErrorMessage extends Envelope<`error`> {
  code: string
  message: string
}

/** 插件送入一篇笔记。assets：令牌 → data URI；writeBack：这个标签页是否开了双向同步 */
export interface InitMessage extends Envelope<`init`> {
  docId: string
  title: string
  path: string
  markdown: string
  assets: Record<string, string>
  writeBack: boolean
}

/** 笔记在 Obsidian 里变了（双向开启时发）。force 为 true 表示用户已选「用笔记版本」，墨笔不再询问 */
export interface UpdateMessage extends Envelope<`update`> {
  docId: string
  markdown: string
  assets: Record<string, string>
  force: boolean
}

export type ConflictReason = `note_changed` | `note_dirty` | `note_missing` | `unsupported`
const CONFLICT_REASONS: readonly string[] = [`note_changed`, `note_dirty`, `note_missing`, `unsupported`]

/** 写回被拒绝；墨笔据此提示用户 */
export interface ConflictMessage extends Envelope<`conflict`> {
  docId: string
  reason: ConflictReason
}

/** 墨笔里的正文有改动（防抖后发，仅双向开启时）。force 为 true 表示用户已选「用墨笔版本」 */
export interface ChangeMessage extends Envelope<`change`> {
  docId: string
  revision: number
  markdown: string
  force: boolean
}

/** 用户选了「用笔记版本」，请插件重新送一份笔记内容 */
export interface PullMessage extends Envelope<`pull`> {
  docId: string
}

/** 墨笔已经应用了插件发来的 update */
export interface AckMessage extends Envelope<`ack`> {
  docId: string
}

export type AppMessage = ReadyMessage | ErrorMessage | ChangeMessage | PullMessage | AckMessage
export type HostMessage = InitMessage | UpdateMessage | ConflictMessage

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === `object` && value !== null
}

function envelopeOf(data: unknown): Record<string, unknown> | null {
  if (!isRecord(data) || data.source !== OBSIDIAN_SOURCE || data.protocol !== OBSIDIAN_PROTOCOL)
    return null
  return typeof data.type === `string` ? data : null
}

/** 来源正确、但协议号与本端不同的消息：返回对方的协议号；其他情况返回 null */
export function peerProtocolOf(data: unknown): number | null {
  if (!isRecord(data) || data.source !== OBSIDIAN_SOURCE || typeof data.type !== `string`)
    return null
  const { protocol } = data
  return typeof protocol === `number` && protocol !== OBSIDIAN_PROTOCOL ? protocol : null
}

export function createReady(appVersion: string): ReadyMessage {
  return { source: OBSIDIAN_SOURCE, protocol: OBSIDIAN_PROTOCOL, type: `ready`, appVersion }
}

export function createError(code: string, message: string): ErrorMessage {
  return { source: OBSIDIAN_SOURCE, protocol: OBSIDIAN_PROTOCOL, type: `error`, code, message }
}

export function createInit(fields: Pick<InitMessage, 'docId' | 'title' | 'path' | 'markdown'> & Partial<Pick<InitMessage, 'assets' | 'writeBack'>>): InitMessage {
  return {
    source: OBSIDIAN_SOURCE,
    protocol: OBSIDIAN_PROTOCOL,
    type: `init`,
    docId: fields.docId,
    title: fields.title,
    path: fields.path,
    markdown: fields.markdown,
    assets: fields.assets ?? {},
    writeBack: fields.writeBack ?? false,
  }
}

export function createUpdate(fields: Pick<UpdateMessage, 'docId' | 'markdown' | 'assets' | 'force'>): UpdateMessage {
  return { source: OBSIDIAN_SOURCE, protocol: OBSIDIAN_PROTOCOL, type: `update`, ...fields }
}

export function createConflict(docId: string, reason: ConflictReason): ConflictMessage {
  return { source: OBSIDIAN_SOURCE, protocol: OBSIDIAN_PROTOCOL, type: `conflict`, docId, reason }
}

export function createChange(fields: Pick<ChangeMessage, 'docId' | 'revision' | 'markdown' | 'force'>): ChangeMessage {
  return { source: OBSIDIAN_SOURCE, protocol: OBSIDIAN_PROTOCOL, type: `change`, ...fields }
}

export function createPull(docId: string): PullMessage {
  return { source: OBSIDIAN_SOURCE, protocol: OBSIDIAN_PROTOCOL, type: `pull`, docId }
}

export function createAck(docId: string): AckMessage {
  return { source: OBSIDIAN_SOURCE, protocol: OBSIDIAN_PROTOCOL, type: `ack`, docId }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every(item => typeof item === `string`)
}

/** 解析墨笔发给插件的消息；不合法返回 null */
export function parseAppMessage(data: unknown): AppMessage | null {
  const record = envelopeOf(data)
  if (!record)
    return null
  const { type, docId } = record
  if (type === `ready` && typeof record.appVersion === `string`)
    return createReady(record.appVersion)
  if (type === `error` && typeof record.code === `string` && typeof record.message === `string`)
    return createError(record.code, record.message)
  if (typeof docId !== `string`)
    return null
  if (type === `change` && typeof record.revision === `number` && Number.isFinite(record.revision) && typeof record.markdown === `string`)
    return createChange({ docId, revision: record.revision, markdown: record.markdown, force: record.force === true })
  if (type === `pull`)
    return createPull(docId)
  if (type === `ack`)
    return createAck(docId)
  return null
}

/** 解析插件发给墨笔的消息；不合法返回 null */
export function parseHostMessage(data: unknown): HostMessage | null {
  const record = envelopeOf(data)
  if (!record)
    return null
  const { type, docId } = record
  if (typeof docId !== `string`)
    return null
  if (type === `init`) {
    const { title, path, markdown } = record
    if (typeof title !== `string` || typeof path !== `string` || typeof markdown !== `string`)
      return null
    const assets = record.assets ?? {}
    if (!isStringRecord(assets))
      return null
    return createInit({ docId, title, path, markdown, assets, writeBack: record.writeBack === true })
  }
  if (type === `update`) {
    const assets = record.assets ?? {}
    if (typeof record.markdown !== `string` || !isStringRecord(assets))
      return null
    return createUpdate({ docId, markdown: record.markdown, assets, force: record.force === true })
  }
  if (type === `conflict` && typeof record.reason === `string` && CONFLICT_REASONS.includes(record.reason))
    return createConflict(docId, record.reason as ConflictReason)
  return null
}
