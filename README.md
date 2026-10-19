# 墨笔 Mobi Editor · Obsidian 插件

在 Obsidian 桌面端打开 [墨笔](https://mobieditor.cn/)，把笔记排版后复制到微信公众号。

Open [Mobi](https://mobieditor.cn/) inside Obsidian desktop, format a note, and copy it into WeChat Official Accounts.

| | |
| --- | --- |
| Plugin id | `mobi` |
| Desktop only | Yes (`isDesktopOnly`: loopback HTTP server for offline mode) |
| License | GNU AGPL-3.0-or-later |

## 功能 / Features

- 用命令、侧边栏或文件菜单打开当前笔记
- **在线模式**：在标签页里加载 `https://mobieditor.cn`
- **离线模式**：使用发布包内嵌的墨笔构建，经本机 `http://127.0.0.1:<port>` 提供，页面本身不从 `mobieditor.cn` 加载
- 可选：把墨笔里的改动写回笔记（双向同步）

## 联网与隐私 / Network use and privacy

请在安装前阅读。Please read before installing.

1. **Online mode** loads `https://mobieditor.cn` in an iframe. The plugin does **not** upload your note to a Mobi server by itself; note text is passed locally between the plugin and that page with `postMessage`. Features on the page (image library, AI, etc.) follow Mobi’s own product behavior and may contact Mobi services when you use them.
2. **Offline mode** serves a **bundled** copy of the web app from a **loopback** server bound to `127.0.0.1` only. The app itself is not loaded from `mobieditor.cn`. The bundle is embedded inside `main.js` (directory installs only download `main.js`, `manifest.json`, and `styles.css`).
3. **Optional features in either mode** only make network requests when you use them: image upload to an image host you configure (for example GitHub, S3-compatible storage, Telegram, or Mobi's image proxy), image display/compression helpers (`wsrv.nl`, `cdn.jsdelivr.net`), some MathJax fonts from `cdn.jsdelivr.net`, and AI features with the provider you configure.
4. **Anonymous usage stats** (feature counts only; never note content, paths, or titles) are **off by default**. You can enable them in plugin settings. If you enable them in online mode, the page may send events to Mobi’s telemetry endpoint. Offline release builds are typically produced **without** a telemetry endpoint, so enabling the toggle does nothing until a build includes one.

中文摘要：

- 在线版会加载 `mobieditor.cn`；插件本身不上传笔记。
- 离线版只在本机 `127.0.0.1` 提供内嵌页面，页面不从 `mobieditor.cn` 加载。
- 图床上传、AI、部分数学公式字体等可选功能只在你使用时才联网，访问你配置的服务。
- 匿名统计**默认关闭**，可在设置里打开；不含笔记正文、路径、标题。

## 安装 / Install

目录上架后：在 Obsidian → 设置 → 第三方插件 → 浏览，搜索「Mobi Editor」。

手动安装：从 GitHub Release 下载 `main.js`、`manifest.json`、`styles.css`，放到库的 `.obsidian/plugins/mobi/`。

## 使用 / Usage

1. 打开一篇 Markdown 笔记。
2. 命令面板运行「用墨笔打开当前笔记」，或点左侧笔形图标。
3. 在墨笔里排版，复制到公众号。
4. 若需要离线，到插件设置把「墨笔来源」改为「离线内置」。

## 从源码构建 / Build from source

```bash
npm install
npm run build:release   # → dist/mobi/{main.js,manifest.json,styles.css}
npm run lint
npm run type-check
```

`assets/mobi-offline.bin` is the prebuilt offline web app that gets embedded into `main.js`. `npm run build` (without `:release`) adds an inline sourcemap.

## 许可证 / License

GNU Affero General Public License v3.0 or later. See [LICENSE](./LICENSE) and [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

## Public repository

This repository contains only the Obsidian plugin. The offline web app is shipped as `assets/mobi-offline.bin` and embedded into `main.js` at build time.
