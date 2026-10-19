import type { ChangeMessage, HostMessage, InitMessage } from './vendor/obsidian-protocol'
import type { ImageData } from './convert'
import type { SyncParts, SyncUnsupportedReason } from './sync-convert'
import { createConflict, createInit, createUpdate } from './vendor/obsidian-protocol'
import { mergeParts, prepareSync, restoreSync, UNSUPPORTED_TEXT } from './sync-convert'

export interface NoteSnapshot {
  /** 磁盘上的原文 */
  text: string
  /** Obsidian 里打开了这篇笔记，且编辑器里有还没保存到磁盘的改动 */
  dirty: boolean
}

export interface NoteIo {
  /** 笔记不存在返回 null */
  read: () => Promise<NoteSnapshot | null>
  /** 原子读改写：updater 收到磁盘当前内容，返回新内容；返回 null 表示放弃写入。返回是否真的写了 */
  write: (updater: (current: string) => string | null) => Promise<boolean>
}

export interface SyncDeps {
  /** 同步期间固定不变（笔记改名后仍用打开时的 docId） */
  docId: string
  fileName: string
  io: NoteIo
  readImage: (ref: string) => Promise<ImageData | null>
  send: (message: HostMessage) => boolean
  onStatus: (text: string) => void
}

export class SyncSession {
  private baseline = ``
  private parts: SyncParts | null = null
  private pending: { text: string } | null = null
  private chain: Promise<unknown> = Promise.resolve()

  constructor(private readonly deps: SyncDeps) {}

  get docId() {
    return this.deps.docId
  }

  /** 所有入口串行执行，避免写回和外部修改事件交错 */
  private run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.chain.then(task, task)
    this.chain = result.catch(() => {})
    return result
  }

  private prepare(text: string) {
    return prepareSync(text, { fileName: this.deps.fileName, readImage: this.deps.readImage })
  }

  /** 读笔记并准备同步。笔记不存在返回 null；不能同步（例如混合换行）返回 unsupported，由调用方回落到单向 */
  open(): Promise<InitMessage | { unsupported: SyncUnsupportedReason } | null> {
    return this.run(async () => {
      const snapshot = await this.deps.io.read()
      if (!snapshot)
        return null
      const prepared = await this.prepare(snapshot.text)
      if (!prepared.ok)
        return { unsupported: prepared.reason }
      this.baseline = snapshot.text
      this.parts = prepared.parts
      this.pending = null
      return createInit({
        docId: this.deps.docId,
        title: prepared.title,
        path: this.deps.docId,
        markdown: prepared.markdown,
        assets: prepared.assets,
        writeBack: true,
      })
    })
  }

  handleChange(message: ChangeMessage): Promise<void> {
    return this.run(async () => {
      const { docId, io, send } = this.deps
      if (message.docId !== docId || !this.parts)
        return
      const snapshot = await io.read()
      if (!snapshot) {
        send(createConflict(docId, `note_missing`))
        return
      }
      if (!message.force) {
        if (snapshot.dirty) {
          send(createConflict(docId, `note_dirty`))
          return
        }
        if (this.pending) {
          send(createConflict(docId, `note_changed`))
          return
        }
      }
      const next = restoreSync(message.markdown, this.parts)
      const previousBaseline = this.baseline
      let conflicted = false
      try {
        await io.write((current) => {
          if (!message.force && current !== previousBaseline) {
            conflicted = true
            return null
          }
          // 回调里同步推进基线：随后到达的 modify 事件读到的就是 baseline，会被当成回声
          this.baseline = next
          return current === next ? null : next
        })
      }
      catch (error) {
        this.baseline = previousBaseline
        this.deps.onStatus(`写回失败：${error instanceof Error ? error.message : String(error)}`)
        return
      }
      if (conflicted) {
        send(createConflict(docId, `note_changed`))
        return
      }
      this.pending = null
    })
  }

  /** 笔记在 Obsidian 里被修改（vault 的 modify 事件） */
  handleExternalModify(): Promise<void> {
    return this.run(async () => {
      const snapshot = await this.deps.io.read()
      if (!snapshot)
        return
      if (!this.pending && snapshot.text === this.baseline)
        return
      if (this.pending?.text === snapshot.text)
        return
      const prepared = await this.prepare(snapshot.text)
      if (!prepared.ok) {
        this.parts = null
        this.deps.onStatus(`笔记现在不能写回：${UNSUPPORTED_TEXT[prepared.reason]}`)
        return
      }
      this.parts = mergeParts(this.parts, prepared.parts)
      this.pending = { text: snapshot.text }
      this.deps.send(createUpdate({ docId: this.deps.docId, markdown: prepared.markdown, assets: prepared.assets, force: false }))
    })
  }

  /** 墨笔已应用 update，基线推进到那一版笔记 */
  handleAck(): Promise<void> {
    return this.run(async () => {
      if (!this.pending)
        return
      this.baseline = this.pending.text
      this.pending = null
    })
  }

  /** 用户选了「用笔记版本」，或点了「从笔记刷新」：把笔记当前内容强制送给墨笔 */
  handlePull(): Promise<void> {
    return this.run(async () => {
      const { docId, io, send } = this.deps
      const snapshot = await io.read()
      if (!snapshot) {
        send(createConflict(docId, `note_missing`))
        return
      }
      const prepared = await this.prepare(snapshot.text)
      if (!prepared.ok) {
        this.parts = null
        this.deps.onStatus(`笔记现在不能写回：${UNSUPPORTED_TEXT[prepared.reason]}`)
        send(createConflict(docId, `unsupported`))
        return
      }
      this.parts = mergeParts(this.parts, prepared.parts)
      this.pending = { text: snapshot.text }
      send(createUpdate({ docId, markdown: prepared.markdown, assets: prepared.assets, force: true }))
    })
  }
}
