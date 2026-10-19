import type { App, MarkdownView } from 'obsidian'
import type { NoteIo } from './sync'
import { TFile } from 'obsidian'

/** 编辑器里的内容统一是 \n；磁盘上可能是 \r\n，比较前先归一 */
function isDirty(app: App, file: TFile, disk: string): boolean {
  const normalized = disk.replace(/\r\n/g, `\n`)
  return app.workspace.getLeavesOfType(`markdown`).some((leaf) => {
    const view = leaf.view as MarkdownView
    return view.file?.path === file.path && view.editor !== undefined && view.editor.getValue() !== normalized
  })
}

/** getPath 每次调用返回笔记当前路径，所以笔记改名后仍然指向同一篇 */
export function createNoteIo(app: App, getPath: () => string): NoteIo {
  const fileOf = () => {
    const file = app.vault.getAbstractFileByPath(getPath())
    return file instanceof TFile ? file : null
  }
  return {
    async read() {
      const file = fileOf()
      if (!file)
        return null
      const text = await app.vault.read(file)
      return { text, dirty: isDirty(app, file, text) }
    },
    async write(updater) {
      const file = fileOf()
      if (!file)
        return false
      let wrote = false
      await app.vault.process(file, (current) => {
        const next = updater(current)
        if (next === null)
          return current
        wrote = true
        return next
      })
      return wrote
    },
  }
}
