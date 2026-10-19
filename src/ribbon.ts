export type RibbonAction
  = | { kind: `reveal`, index: number }
    | { kind: `open`, path: string }

/**
 * 侧边栏按钮点下去该做什么。
 * 当前是 Markdown 笔记就用墨笔打开它，否则打开不带笔记的墨笔（path 为空串）；
 * 目标已经有墨笔标签页时直接切过去，不重复开。
 * openPaths 是已开着的墨笔标签页各自绑定的笔记路径，顺序与标签页一致。
 */
export function pickRibbonAction(
  active: { path: string, extension: string } | null,
  openPaths: readonly string[],
): RibbonAction {
  const path = active && active.extension === `md` ? active.path : ``
  const index = openPaths.indexOf(path)
  return index >= 0 ? { kind: `reveal`, index } : { kind: `open`, path }
}

/**
 * 墨笔标签页绑定的笔记路径，读视图状态而不是视图实例：
 * Obsidian 会延迟加载后台标签页，那时 leaf.view 还不是 MobiView，实例上读不到 notePath。
 */
export function leafNotePath(viewState: { state?: unknown } | null): string {
  const path = (viewState?.state as { path?: unknown } | undefined)?.path
  return typeof path === `string` ? path : ``
}
