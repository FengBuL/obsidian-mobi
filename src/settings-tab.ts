import type { App } from 'obsidian'
import type MobiPlugin from './main'
import { PluginSettingTab, Setting, Notice } from 'obsidian'
import { normalizeSettings } from './settings'

export class MobiSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: MobiPlugin) {
    super(app, plugin)
  }

  private showOfflineInfo(containerEl: HTMLElement) {
    const info = this.plugin.offlineVersionInfo()
    let text = `没有找到离线包`
    if (info.source !== `missing`) {
      const where = info.source === `embedded` ? `已内嵌在插件中` : `来自插件目录 mobi-app`
      text = `内置墨笔 ${info.appVersion ?? `未知版本`}（构建于 ${info.builtAt?.slice(0, 10) ?? `未知`}，${info.telemetry ? `带` : `不带`}匿名统计；${where}）`
      if (this.plugin.settings.offlinePort)
        text += `；本机端口 ${this.plugin.settings.offlinePort}`
    }
    containerEl.createEl(`p`, { text, cls: `setting-item-description` })
  }

  display() {
    const { containerEl } = this
    containerEl.empty()
    containerEl.createEl(`p`, {
      text: `Network use: Online mode loads https://mobieditor.cn in a tab. Note content stays between this plugin and that page on your device; the plugin itself does not upload notes. Image upload, AI requests, and anonymous usage stats are handled by the Mobi page under its own terms. Offline mode serves a bundled build on http://127.0.0.1 only and does not contact mobieditor.cn. Anonymous usage stats are off by default; turn them on below if you want to help. Stats never include note content, paths, or titles.`,
    })
    new Setting(containerEl)
      .setName(`墨笔来源`)
      .setDesc(`在线：加载 mobieditor.cn，永远是最新版，需要联网。离线内置：用插件内嵌的墨笔构建，经本机 127.0.0.1 的端口提供，不访问 mobieditor.cn；版本随插件更新，可能落后。在线和离线是两份独立的本地数据（稿子、AI Key、主题不互通）。只对之后打开的墨笔标签页生效。`)
      .addDropdown(dropdown => dropdown
        .addOption(`online`, `在线（mobieditor.cn）`)
        .addOption(`offline`, `离线内置`)
        .setValue(this.plugin.settings.source)
        .onChange(async (value) => {
          this.plugin.settings = normalizeSettings({ ...this.plugin.settings, source: value })
          await this.plugin.saveData(this.plugin.settings)
        }))
    this.showOfflineInfo(containerEl)
    new Setting(containerEl)
      .setName(`允许匿名使用统计`)
      .setDesc(`默认关闭。打开后，墨笔页面可以把匿名功能使用次数发到墨笔的统计服务（不含笔记内容、路径和标题）。离线包如果构建时没有统计端点，打开此项也不会发送。只对之后打开的墨笔标签页生效。`)
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.allowTelemetry)
        .onChange(async (value) => {
          this.plugin.settings = normalizeSettings({ ...this.plugin.settings, allowTelemetry: value })
          await this.plugin.saveData(this.plugin.settings)
        }))
    new Setting(containerEl)
      .setName(`离线端口`)
      .setDesc(`离线版在本机 127.0.0.1 的这个端口上提供。端口是来源的一部分：换端口等于换一个来源，墨笔里的稿子、AI Key 和主题会看起来丢了（旧端口下的数据还在，改回即可）。留空表示下次启动时重新随机选一个。填 1024 到 65535 之间的数字；修改后需要在「已安装插件」里关闭再打开本插件才会生效。`)
      .addText(text => text
        .setPlaceholder(`自动选择`)
        .setValue(this.plugin.settings.offlinePort ? String(this.plugin.settings.offlinePort) : ``)
        .onChange(async (value) => {
          const port = value.trim() === `` ? 0 : Number(value)
          this.plugin.settings = normalizeSettings({ ...this.plugin.settings, offlinePort: port })
          await this.plugin.saveData(this.plugin.settings)
        }))
    new Setting(containerEl)
      .setName(`墨笔里的改动自动写回笔记`)
      .setDesc(`默认关闭。打开后，在墨笔里改的正文会写回这篇笔记（frontmatter、图片原写法、双链、callout 保持原样），笔记在 Obsidian 里的修改也会同步进墨笔；两边都改了会让你选一边。墨笔的 AI 改写结果也会写进笔记，建议同时启用 Obsidian 的「文件恢复」核心插件。只对之后打开的墨笔标签页生效，已打开的请关掉重开。`)
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.writeBack)
        .onChange(async (value) => {
          this.plugin.settings = normalizeSettings({ ...this.plugin.settings, writeBack: value })
          await this.plugin.saveData(this.plugin.settings)
          if (value)
            void new Notice(`双向同步已打开，请重新打开墨笔标签页后生效`)
        }))
    new Setting(containerEl)
      .setName(`开发用墨笔地址`)
      .setDesc(`留空使用线上墨笔。只在联调时填写，只接受本机地址（localhost、127.0.0.1、[::1]），例如 http://127.0.0.1:5173/mobi/`)
      .addText(text => text
        .setPlaceholder(`留空`)
        .setValue(this.plugin.settings.devUrl)
        .onChange(async (value) => {
          this.plugin.settings = normalizeSettings({ ...this.plugin.settings, devUrl: value })
          await this.plugin.saveData(this.plugin.settings)
        }))
  }
}
