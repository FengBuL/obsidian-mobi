import type { Listening } from './offline'
import type { LoadedPack } from './offline-pack'
import type { MobiSettings } from './settings'
import type { AppSource } from './source'
import { normalizePath, Notice, Platform, Plugin, requestUrl, TFile } from 'obsidian'
import { startOfflineServer } from './offline'
import { loadOfflinePack, OFFLINE_PACK_FILE, offlinePackUrl } from './offline-pack'
import { EXPECTED_OFFLINE_PACK } from './offline-pack-info'
import { leafNotePath, pickRibbonAction } from './ribbon'
import { DEFAULT_SETTINGS, normalizeSettings } from './settings'
import { MobiSettingTab } from './settings-tab'
import { resolveAppSource, resolveOfflineSource } from './source'
import { createStaticServer } from './static-server'
import { MobiView, VIEW_TYPE } from './view'

export type OfflinePackStatus
  = | { state: `unavailable` }
    | { state: `missing`, sizeMb: number }
    | { state: `ready`, sizeMb: number }

export default class MobiPlugin extends Plugin {
  settings: MobiSettings = { ...DEFAULT_SETTINGS }
  private offline: Listening | null = null
  private offlineStarting: Promise<Listening> | null = null
  private packLoading: Promise<LoadedPack> | null = null
  private pack: LoadedPack | null = null

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

  /** 离线包在插件目录里的位置（通过 Obsidian 的 vault 接口读写，不直接碰文件系统） */
  private packPath(): string {
    return normalizePath(`${this.manifest.dir ?? ``}/${OFFLINE_PACK_FILE}`)
  }

  async offlinePackStatus(): Promise<OfflinePackStatus> {
    if (!EXPECTED_OFFLINE_PACK.sha256)
      return { state: `unavailable` }
    const sizeMb = Math.round(EXPECTED_OFFLINE_PACK.size / 1024 / 1024 * 10) / 10
    if (this.pack)
      return { state: `ready`, sizeMb }
    const adapter = this.app.vault.adapter
    const path = this.packPath()
    if (await adapter.exists(path) && (await adapter.stat(path))?.size === EXPECTED_OFFLINE_PACK.size)
      return { state: `ready`, sizeMb }
    return { state: `missing`, sizeMb }
  }

  /** 已加载的离线包的版本信息；还没加载过返回 null */
  offlineVersionInfo() {
    return this.pack?.info ?? null
  }

  /** 读本地离线包；没有或校验不过就从本插件的 GitHub Release 下载并核对 SHA-256。并发调用共用同一次加载 */
  loadOfflinePack(): Promise<LoadedPack> {
    if (this.pack)
      return Promise.resolve(this.pack)
    let loading = this.packLoading
    if (!loading) {
      loading = loadOfflinePack({
        storage: this.app.vault.adapter,
        path: this.packPath(),
        expected: EXPECTED_OFFLINE_PACK,
        download: async () => {
          void new Notice(`正在从 GitHub 下载墨笔离线包（约 ${Math.round(EXPECTED_OFFLINE_PACK.size / 1024 / 1024)} MB），完成后自动打开`, 8000)
          const response = await requestUrl({ url: offlinePackUrl(this.manifest.version), throw: true })
          return response.arrayBuffer
        },
      }).then((pack) => {
        this.pack = pack
        return pack
      }).finally(() => { this.packLoading = null })
      this.packLoading = loading
    }
    return loading
  }

  /** 懒启动：第一个离线标签页打开时才起服务；并发调用共用同一次启动 */
  ensureOfflineServer(): Promise<Listening> {
    if (!Platform.isDesktop)
      return Promise.reject(new Error(`墨笔离线版只在桌面端可用`))
    if (this.offline)
      return Promise.resolve(this.offline)
    let starting = this.offlineStarting
    if (!starting) {
      starting = (async () => {
        const pack = await this.loadOfflinePack()
        const started = await startOfflineServer({
          saved: this.settings.offlinePort,
          random: Math.random,
          listen: port => createStaticServer({ files: pack.files, port }),
          save: async (port) => {
            this.settings = normalizeSettings({ ...this.settings, offlinePort: port })
            await this.saveData(this.settings)
          },
        })
        if (started.notice)
          void new Notice(started.notice, 15000)
        this.offline = { port: started.port, close: started.close }
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
