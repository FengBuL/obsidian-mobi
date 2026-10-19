import type { Listening } from './offline'
import type { MobiSettings } from './settings'
import type { AppSource } from './source'
import type { StaticFiles } from './static-server'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FileSystemAdapter, Notice, Platform, Plugin, TFile } from 'obsidian'
import { readOfflineVersion, unpackOfflineArchive } from './offline-archive'
import { startOfflineServer } from './offline'
import { leafNotePath, pickRibbonAction } from './ribbon'
import { DEFAULT_SETTINGS, normalizeSettings } from './settings'
import { MobiSettingTab } from './settings-tab'
import { resolveAppSource, resolveOfflineSource } from './source'
import { createStaticServer } from './static-server'
import { MobiView, VIEW_TYPE } from './view'
import OFFLINE_BUNDLE from 'virtual:offline-bundle'

export default class MobiPlugin extends Plugin {
  settings: MobiSettings = { ...DEFAULT_SETTINGS }
  private offline: (Listening & { rootLabel: string }) | null = null
  private offlineStarting: Promise<Listening & { rootLabel: string }> | null = null
  private embeddedFiles: Map<string, Uint8Array> | null | undefined

  async onload() {
    this.settings = normalizeSettings(await this.loadData())
    this.registerView(VIEW_TYPE, leaf => new MobiView(leaf, () => this.resolveSourceAsync(), () => this.settings.writeBack))
    this.addSettingTab(new MobiSettingTab(this.app, this))

    this.addCommand({
      id: `open-current-note`,
      name: `用墨笔打开当前笔记`,
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile()
        if (!file || file.extension !== `md`)
          return false
        if (!checking)
          void this.openNote(file)
        return true
      },
    })
    this.addCommand({ id: `open-mobi`, name: `打开墨笔（不带笔记）`, callback: () => void this.openLeaf(``) })
    this.addRibbonIcon(`pen-line`, `打开墨笔`, () => void this.openFromRibbon())

    this.registerEvent(this.app.workspace.on(`file-menu`, (menu, file) => {
      if (file instanceof TFile && file.extension === `md`)
        menu.addItem(item => item.setTitle(`用墨笔打开`).setIcon(`pen-line`).onClick(() => void this.openNote(file)))
    }))
    this.registerEvent(this.app.workspace.on(`editor-menu`, (menu, _editor, info) => {
      const file = info.file
      if (file && file.extension === `md`)
        menu.addItem(item => item.setTitle(`用墨笔打开`).setIcon(`pen-line`).onClick(() => void this.openNote(file)))
    }))
  }

  onunload() {
    const server = this.offline
    this.offline = null
    if (server)
      void server.close()
  }

  resolveSource(): AppSource {
    return resolveAppSource(this.settings, this.manifest.version)
  }

  /** 开发用：磁盘上的 mobi-app 目录（完整插件包或本地 build:offline） */
  offlineDiskRoot(): string | null {
    const adapter = this.app.vault.adapter
    if (!(adapter instanceof FileSystemAdapter))
      return null
    return join(adapter.getBasePath(), this.manifest.dir ?? ``, `mobi-app`)
  }

  /** 兼容旧设置页文案 */
  offlineRoot(): string | null {
    return this.offlineDiskRoot()
  }

  getEmbeddedOfflineFiles(): Map<string, Uint8Array> | null {
    if (this.embeddedFiles !== undefined)
      return this.embeddedFiles
    if (!(OFFLINE_BUNDLE instanceof Uint8Array) || OFFLINE_BUNDLE.byteLength === 0) {
      this.embeddedFiles = null
      return null
    }
    try {
      this.embeddedFiles = unpackOfflineArchive(OFFLINE_BUNDLE)
    }
    catch {
      this.embeddedFiles = null
    }
    return this.embeddedFiles
  }

  offlineVersionInfo(): { appVersion?: string, builtAt?: string, telemetry?: boolean, source: `disk` | `embedded` | `missing` } {
    const disk = this.offlineDiskRoot()
    if (disk && existsSync(join(disk, `index.html`))) {
      try {
        const info = JSON.parse(readFileSync(join(disk, `VERSION.json`), `utf8`)) as { appVersion?: string, builtAt?: string, telemetry?: boolean }
        return { ...info, source: `disk` }
      }
      catch {
        return { source: `disk` }
      }
    }
    const embedded = this.getEmbeddedOfflineFiles()
    if (embedded) {
      const info = readOfflineVersion(embedded) ?? {}
      return { ...info, source: `embedded` }
    }
    return { source: `missing` }
  }

  resolveOfflineFiles(): StaticFiles {
    const disk = this.offlineDiskRoot()
    if (disk && existsSync(join(disk, `index.html`)))
      return { kind: `disk`, root: disk }
    const embedded = this.getEmbeddedOfflineFiles()
    if (embedded?.has(`index.html`))
      return { kind: `memory`, files: embedded }
    throw new Error(`没有可用的离线墨笔（目录安装应使用内嵌包；开发时可运行 pnpm --filter @mobi/obsidian build:offline）`)
  }

  /** 懒启动：第一个离线标签页打开时才起服务；并发调用共用同一次启动 */
  ensureOfflineServer(): Promise<Listening & { rootLabel: string }> {
    if (!Platform.isDesktop)
      return Promise.reject(new Error(`墨笔离线版只在桌面端可用`))
    if (this.offline)
      return Promise.resolve(this.offline)
    let starting = this.offlineStarting
    if (!starting) {
      starting = (async () => {
        const files = this.resolveOfflineFiles()
        const rootLabel = files.kind === `disk` ? files.root : `embedded`
        const started = await startOfflineServer({
          saved: this.settings.offlinePort,
          random: Math.random,
          listen: port => createStaticServer({ files, port }),
          save: async (port) => {
            this.settings = normalizeSettings({ ...this.settings, offlinePort: port })
            await this.saveData(this.settings)
          },
        })
        if (started.notice)
          void new Notice(started.notice, 15000)
        this.offline = { port: started.port, close: started.close, rootLabel }
        return this.offline
      })().finally(() => { this.offlineStarting = null })
      this.offlineStarting = starting
    }
    return starting
  }

  /** 视图用：按设置解析来源；离线时先确保服务已启动 */
  async resolveSourceAsync(): Promise<AppSource> {
    if (this.settings.devUrl || this.settings.source !== `offline`)
      return this.resolveSource()
    const server = await this.ensureOfflineServer()
    return resolveOfflineSource(server.port, this.manifest.version, this.settings.allowTelemetry)
  }

  /** 侧边栏按钮：当前笔记用墨笔打开；没有就打开空白墨笔；已开着的标签页直接切过去 */
  async openFromRibbon() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE)
    const action = pickRibbonAction(
      this.app.workspace.getActiveFile(),
      leaves.map(leaf => leafNotePath(leaf.getViewState())),
    )
    if (action.kind === `reveal`)
      await this.app.workspace.revealLeaf(leaves[action.index])
    else
      await this.openLeaf(action.path)
  }

  /** 同一篇笔记已经开着墨笔标签页时直接切过去 */
  async openNote(file: TFile) {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)
      .find(leaf => leafNotePath(leaf.getViewState()) === file.path)
    if (existing) {
      await this.app.workspace.revealLeaf(existing)
      return
    }
    await this.openLeaf(file.path)
  }

  async openLeaf(path: string) {
    const leaf = this.app.workspace.getLeaf(`tab`)
    await leaf.setViewState({ type: VIEW_TYPE, active: true, state: { path } })
    await this.app.workspace.revealLeaf(leaf)
  }
}
