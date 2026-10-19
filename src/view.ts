import type { ViewStateResult, WorkspaceLeaf } from 'obsidian'
import type { HostBridge } from './bridge'
import type { ImageData } from './convert'
import type { AppSource } from './source'
import { createInit, PROTOCOL_MISMATCH_CODE } from './vendor/obsidian-protocol'
import { arrayBufferToBase64, ItemView, Notice, TFile } from 'obsidian'
import { createHostBridge } from './bridge'
import { convertNote } from './convert'
import { createNoteIo } from './note-io'
import { SyncSession } from './sync'
import { UNSUPPORTED_TEXT } from './sync-convert'

export const VIEW_TYPE = `mobi-view`

const READY_TIMEOUT_MS = 10_000
const MAX_IMAGE_BYTES = 3 * 1024 * 1024
const MIME_BY_EXT: Record<string, string> = {
  png: `image/png`,
  jpg: `image/jpeg`,
  jpeg: `image/jpeg`,
  gif: `image/gif`,
  webp: `image/webp`,
  svg: `image/svg+xml`,
  bmp: `image/bmp`,
}

export class MobiView extends ItemView {
  private path = ``
  private bridge: HostBridge | null = null
  private toolbarTitleEl: HTMLElement | null = null
  private statusEl: HTMLElement | null = null
  private frameHost: HTMLElement | null = null
  private rendered = false
  private appReady = false
  private appVersion = ``
  private readyTimer: number | null = null

  private session: SyncSession | null = null
  /** 这篇笔记没法双向同步时的原因；送入后继续显示在状态栏里 */
  private oneWayReason = ``

  constructor(leaf: WorkspaceLeaf, private readonly resolveSource: () => Promise<AppSource>, private readonly getWriteBack: () => boolean) {
    super(leaf)
  }

  get notePath() {
    return this.path
  }

  getViewType() {
    return VIEW_TYPE
  }

  getDisplayText() {
    return this.path ? `墨笔 · ${this.noteName()}` : `墨笔`
  }

  getIcon() {
    return `pen-line`
  }

  getState() {
    // path 为空字符串表示没有绑定笔记
    return { path: this.path }
  }

  async setState(state: unknown, result: ViewStateResult) {
    const raw = (state as { path?: unknown } | null)?.path
    const path = typeof raw === `string` ? raw : ``
    const changed = path !== this.path
    this.path = path
    if (this.frameHost) {
      if (!this.rendered) {
        void this.render()
      }
      else if (changed) {
        this.updateTitle()
        if (this.appReady)
          void this.sendNote()
      }
    }
    await super.setState(state, result)
  }

  async onOpen() {
    this.contentEl.addClass(`mobi-view`)
    const toolbar = this.contentEl.createDiv({ cls: `mobi-toolbar` })
    this.toolbarTitleEl = toolbar.createSpan({ cls: `mobi-title` })
    this.statusEl = toolbar.createSpan({ cls: `mobi-status` })
    const refresh = toolbar.createEl(`button`, { text: `从笔记刷新` })
    refresh.addEventListener(`click`, () => {
      if (this.session)
        void this.session.handlePull()
      else
        void this.sendNote()
    })
    this.frameHost = this.contentEl.createDiv({ cls: `mobi-frame-host` })
    this.registerEvent(this.app.workspace.on(`window-open`, (_workspaceWindow, win) => this.bridge?.addTarget(win)))
    this.registerEvent(this.app.vault.on(`rename`, (file, oldPath) => {
      if (oldPath !== this.path)
        return
      this.path = file.path
      this.updateTitle()
      this.app.workspace.requestSaveLayout()
    }))
    this.registerEvent(this.app.vault.on(`modify`, (file) => {
      if (file.path === this.path && this.session)
        void this.session.handleExternalModify()
    }))
    this.registerEvent(this.app.vault.on(`delete`, (file) => {
      if (file.path !== this.path)
        return
      this.setStatus(`笔记已被删除，墨笔里的内容保留`)
    }))
    void this.render()
  }

  async onClose() {
    this.clearReadyTimer()
    this.bridge?.dispose()
    this.bridge = null
    this.session = null
    this.rendered = false
    this.appReady = false
    this.frameHost = null
    this.toolbarTitleEl = null
    this.statusEl = null
  }

  private noteName() {
    return (this.path.split(`/`).pop() ?? this.path).replace(/\.md$/i, ``)
  }

  private updateTitle() {
    this.toolbarTitleEl?.setText(this.path ? this.noteName() : `墨笔`)
    // 让标签页标题跟着变；updateHeader 不在公开类型里
    const leaf = this.leaf as unknown as { updateHeader?: () => void }
    leaf.updateHeader?.()
  }

  private clearReadyTimer() {
    if (this.readyTimer !== null) {
      window.clearTimeout(this.readyTimer)
      this.readyTimer = null
    }
  }

  private setStatus(text: string) {
    this.statusEl?.setText(text)
  }

  private async readImage(ref: string, sourcePath: string): Promise<ImageData | null> {
    const target = this.app.metadataCache.getFirstLinkpathDest(ref, sourcePath)
    if (!target || target.stat.size > MAX_IMAGE_BYTES)
      return null
    const mime = MIME_BY_EXT[target.extension.toLowerCase()]
    if (!mime)
      return null
    return { mime, base64: arrayBufferToBase64(await this.app.vault.readBinary(target)) }
  }

  private startSession(file: TFile): SyncSession {
    const session = new SyncSession({
      docId: file.path,
      fileName: file.name,
      io: createNoteIo(this.app, () => this.path),
      readImage: ref => this.readImage(ref, this.path),
      send: message => this.bridge?.send(message) === true,
      onStatus: text => this.setStatus(text),
    })
    this.session = session
    return session
  }

  private async sendNote() {
    if (!this.path) {
      this.setStatus(`已就绪（没有绑定笔记）`)
      return
    }
    const file = this.app.vault.getAbstractFileByPath(this.path)
    if (!(file instanceof TFile)) {
      this.setStatus(`找不到笔记：${this.path}`)
      return
    }
    if (this.getWriteBack()) {
      this.oneWayReason = ``
      const session = this.session ?? this.startSession(file)
      try {
        const init = await session.open()
        if (init && `type` in init) {
          const sent = this.bridge?.send(init) === true
          this.setStatus(sent ? `已送入，双向同步已开启` : `送入失败（iframe 不可用）`)
          return
        }
        if (init && `unsupported` in init) {
          this.session = null
          this.oneWayReason = UNSUPPORTED_TEXT[init.unsupported]
        }
      }
      catch (error) {
        this.session = null
        this.setStatus(`送入失败：${error instanceof Error ? error.message : String(error)}`)
        return
      }
    }
    try {
      const raw = await this.app.vault.read(file)
      const converted = await convertNote(raw, {
        fileName: file.name,
        readImage: ref => this.readImage(ref, file.path),
      })
      const sent = this.bridge?.send(createInit({
        docId: file.path,
        title: converted.title,
        path: file.path,
        markdown: converted.markdown,
      })) === true
      if (!sent) {
        this.setStatus(`送入失败（iframe 不可用）`)
        return
      }
      const count = converted.warnings.length
      if (count) {
        this.setStatus(`已送入，${count} 处没处理好：${converted.warnings[0]}`)
        void new Notice(`墨笔：${count} 处没处理好，${converted.warnings[0]}`)
      }
      else {
        const version = this.appVersion ? `（墨笔 ${this.appVersion}）` : ``
        this.setStatus(this.oneWayReason ? `已送入${version}，但这篇笔记只能单向：${this.oneWayReason}` : `已送入${version}`)
      }
    }
    catch (error) {
      this.setStatus(`送入失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async render() {
    if (!this.frameHost)
      return
    this.rendered = true
    this.appReady = false
    this.clearReadyTimer()
    this.bridge?.dispose()
    this.frameHost.empty()
    this.updateTitle()
    this.setStatus(`准备墨笔…`)
    let source: AppSource
    try {
      source = await this.resolveSource()
    }
    catch (error) {
      this.rendered = false
      this.setStatus(`没有启动成功：${error instanceof Error ? error.message : String(error)}`)
      return
    }
    // await 期间视图可能已经被关闭
    if (!this.frameHost)
      return
    const frame = this.frameHost.createEl(`iframe`, { cls: `mobi-frame` })
    frame.setAttribute(`allow`, `clipboard-read; clipboard-write`)
    this.setStatus(`加载 ${source.kind}：${source.origin}`)
    frame.addEventListener(`load`, () => {
      // 标签页被移到弹出窗口后 iframe 会重载，保证当前所在窗口一定在监听
      const owner = this.containerEl.ownerDocument.defaultView
      if (owner)
        this.bridge?.addTarget(owner)
      if (!this.appReady)
        this.setStatus(`页面已加载，等待 ready`)
    })
    this.readyTimer = window.setTimeout(() => {
      this.readyTimer = null
      if (!this.appReady)
        this.setStatus(`10 秒内没有收到 ready：页面可能没加载成功，或者该页面还没有嵌入握手`)
    }, READY_TIMEOUT_MS)
    this.bridge = createHostBridge({
      target: this.containerEl.ownerDocument.defaultView ?? window,
      getFrame: () => frame.contentWindow,
      expectedOrigin: source.origin,
      onMessage: (message) => {
        if (message.type === `ready`) {
          this.appReady = true
          this.appVersion = message.appVersion
          this.clearReadyTimer()
          this.setStatus(`ready（墨笔 ${message.appVersion}）`)
          this.session = null
          void this.sendNote()
        }
        else if (message.type === `error`) {
          if (message.code === PROTOCOL_MISMATCH_CODE)
            this.setStatus(`插件与墨笔的协议版本不一致，请更新插件（${message.message}）`)
          else
            this.setStatus(`墨笔报告错误：${message.code} ${message.message}`)
        }
        else if (this.session && message.docId === this.session.docId) {
          if (message.type === `change`)
            void this.session.handleChange(message)
          else if (message.type === `pull`)
            void this.session.handlePull()
          else
            void this.session.handleAck()
        }
      },
      onRejected: origin => this.setStatus(`丢弃了来源 ${origin} 的消息（期望 ${source.origin}）`),
    })
    frame.src = source.url
  }
}
