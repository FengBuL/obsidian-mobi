import type { App, SettingDefinitionControl, SettingDefinitionItem } from 'obsidian'
import type MobiPlugin from './main'
import type { MobiSettings } from './settings'
import { Notice, PluginSettingTab, Setting } from 'obsidian'
import { normalizeSettings } from './settings'

const PORT_ERROR = `请输入 1024 到 65535 之间的整数，或留空`

function validatePort(value: string): string | undefined {
  const text = value.trim()
  if (text === ``)
    return undefined
  const port = Number(text)
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? undefined : PORT_ERROR
}

export class MobiSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: MobiPlugin) {
    super(app, plugin)
  }

  /**
   * Obsidian 1.13.0 起用这份声明渲染设置页，并把每一项纳入设置搜索；
   * 更早的版本不认识它，会走下面的 display()，两边用的是同一份定义。
   */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: `Network use`,
        desc: `Online mode loads https://mobieditor.cn in a tab. Note content stays between this plugin and that page on your device; the plugin itself does not upload notes. Image upload, AI requests, and anonymous usage stats are handled by the Mobi page under its own terms. Offline mode serves a downloaded build on http://127.0.0.1 only and does not contact mobieditor.cn; the build itself is downloaded once from this plugin's GitHub release (github.com/FengBuL/obsidian-mobi) and checked against a SHA-256 recorded in the plugin. Anonymous usage stats are off by default; turn them on below if you want to help. Stats never include note content, paths, or titles.`,
        aliases: [`联网说明`, `隐私`, `privacy`],
      },
      {
        name: `墨笔来源`,
        desc: `在线：加载 mobieditor.cn，永远是最新版，需要联网。离线：用离线包里的墨笔构建，经本机 127.0.0.1 的端口提供，不访问 mobieditor.cn；版本随插件更新，可能落后。在线和离线是两份独立的本地数据（稿子、AI Key、主题不互通）。只对之后打开的墨笔标签页生效。`,
        aliases: [`在线`, `离线`, `source`, `offline`],
        control: {
          type: `dropdown`,
          key: `source`,
          options: { online: `在线（mobieditor.cn）`, offline: `离线内置` },
        },
      },
      {
        name: `离线包`,
        desc: `检查中…`,
        aliases: [`下载`, `离线版`, `mobi-offline.bin`],
        render: setting => this.renderPackRow(setting),
      },
      {
        name: `允许匿名使用统计`,
        desc: `默认关闭。打开后，墨笔页面可以把匿名功能使用次数发到墨笔的统计服务（不含笔记内容、路径和标题）。离线包如果构建时没有统计端点，打开此项也不会发送。只对之后打开的墨笔标签页生效。`,
        aliases: [`telemetry`, `统计`],
        control: { type: `toggle`, key: `allowTelemetry` },
      },
      {
        name: `离线端口`,
        desc: `离线版在本机 127.0.0.1 的这个端口上提供。端口是来源的一部分：换端口等于换一个来源，墨笔里的稿子、AI Key 和主题会看起来丢了（旧端口下的数据还在，改回即可）。留空表示下次启动时重新随机选一个。填 1024 到 65535 之间的数字；修改后需要在「已安装插件」里关闭再打开本插件才会生效。`,
        aliases: [`port`],
        control: { type: `text`, key: `offlinePort`, placeholder: `自动选择`, validate: validatePort },
      },
      {
        name: `墨笔里的改动自动写回笔记`,
        desc: `默认关闭。打开后，在墨笔里改的正文会写回这篇笔记（frontmatter、图片原写法、双链、callout 保持原样），笔记在 Obsidian 里的修改也会同步进墨笔；两边都改了会让你选一边。墨笔的 AI 改写结果也会写进笔记，建议同时启用 Obsidian 的「文件恢复」核心插件。只对之后打开的墨笔标签页生效，已打开的请关掉重开。`,
        aliases: [`写回`, `同步`, `sync`, `write back`],
        control: { type: `toggle`, key: `writeBack` },
      },
      {
        name: `开发用墨笔地址`,
        desc: `留空使用线上墨笔。只在联调时填写，只接受本机地址（localhost、127.0.0.1、[::1]），例如 http://127.0.0.1:5173/mobi/`,
        aliases: [`dev`, `devUrl`],
        control: { type: `text`, key: `devUrl`, placeholder: `留空` },
      },
    ]
  }

  getControlValue(key: string): unknown {
    const value = this.plugin.settings[key as keyof MobiSettings]
    if (key === `offlinePort`)
      return value ? String(value) : ``
    return value
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const next = key === `offlinePort` ? (String(value).trim() === `` ? 0 : Number(value)) : value
    this.plugin.settings = normalizeSettings({ ...this.plugin.settings, [key]: next })
    await this.plugin.saveData(this.plugin.settings)
    if (key === `writeBack` && value === true)
      void new Notice(`双向同步已打开，请重新打开墨笔标签页后生效`)
  }

  /** 离线包的状态与下载按钮；状态是异步查的，查到后原地更新这一行 */
  private renderPackRow(setting: Setting) {
    const baseDesc = `离线版用到的墨笔网页包。首次使用离线版时自动从本插件的 GitHub Release 下载，用插件里记录的 SHA-256 核对后保存在插件目录；也可以在这里提前下载。`
    let button: HTMLButtonElement | null = null
    const refresh = async () => {
      const status = await this.plugin.offlinePackStatus()
      const info = this.plugin.offlineVersionInfo()
      let state: string
      if (status.state === `unavailable`)
        state = `这个插件版本没有附带离线包，离线来源不可用。`
      else if (status.state === `ready`)
        state = info
          ? `已就绪：内置墨笔 ${info.appVersion ?? `未知版本`}（构建于 ${info.builtAt?.slice(0, 10) ?? `未知`}，${info.telemetry ? `带` : `不带`}匿名统计）。`
          : `已下载（约 ${status.sizeMb} MB），首次打开离线标签页时校验。`
      else
        state = `还没有下载（约 ${status.sizeMb} MB）。`
      if (this.plugin.settings.offlinePort)
        state += ` 本机端口 ${this.plugin.settings.offlinePort}。`
      setting.setDesc(`${baseDesc}${state}`)
      button?.toggleAttribute(`disabled`, status.state === `unavailable`)
      button?.setText(status.state === `ready` ? `重新校验` : `下载`)
    }
    setting.setDesc(baseDesc)
    setting.addButton(btn => btn
      .setButtonText(`下载`)
      .onClick(async () => {
        btn.setDisabled(true)
        try {
          await this.plugin.loadOfflinePack()
          void new Notice(`离线包已就绪`)
        }
        catch (error) {
          void new Notice(`离线包不可用：${error instanceof Error ? error.message : String(error)}`, 10000)
        }
        finally {
          btn.setDisabled(false)
          await refresh()
        }
      }))
    button = setting.controlEl.querySelector(`button`)
    void refresh()
  }

  /** Obsidian 1.13.0 之前的渲染路径：把同一份定义用 Setting 逐项画出来 */
  display() {
    const { containerEl } = this
    containerEl.empty()
    for (const def of this.getSettingDefinitions()) {
      if (!(`name` in def))
        continue
      const setting = new Setting(containerEl).setName(def.name)
      if (typeof def.desc === `string`)
        setting.setDesc(def.desc)
      if (`render` in def && def.render)
        // 这一份定义的 render 不用第二个参数（SettingGroup 是 1.11 才有的类）
        def.render(setting, undefined as never)
      else if (`control` in def && def.control)
        this.renderControl(setting, def)
    }
  }

  private renderControl(setting: Setting, def: SettingDefinitionControl) {
    const control = def.control
    const value = this.getControlValue(control.key)
    const save = (next: unknown) => void this.setControlValue(control.key, next)
    if (control.type === `dropdown`)
      setting.addDropdown(dropdown => dropdown.addOptions(control.options).setValue(typeof value === `string` ? value : ``).onChange(save))
    else if (control.type === `toggle`)
      setting.addToggle(toggle => toggle.setValue(value === true).onChange(save))
    else if (control.type === `text`)
      setting.addText(text => text.setPlaceholder(control.placeholder ?? ``).setValue(typeof value === `string` ? value : ``).onChange(save))
  }
}
