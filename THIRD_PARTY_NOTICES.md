# Third-party notices / 第三方说明

墨笔 Obsidian 插件以 [GNU AGPL-3.0-or-later](./LICENSE) 授权。发布包 `main.js` 内嵌离线墨笔网页构建，其中还包含下列第三方成分。

This plugin is licensed under [GNU AGPL-3.0-or-later](./LICENSE). The release `main.js` embeds an offline build of the Mobi web app, which includes the following third-party components.

## doocs/md

- Upstream: <https://github.com/doocs/md>
- License: WTFPL Version 2（见 `third_party/licenses/doocs-md-WTFPL.txt`）
- Note: Parts of the embedded web editor descend from doocs/md.

## Turndown

- Upstream: <https://github.com/mixmark-io/turndown>, <https://github.com/mixmark-io/turndown-plugin-gfm>
- License: MIT
- Used by the embedded web app to convert pasted rich text to Markdown.

## Source Han Serif (思源宋体)

- Upstream: <https://github.com/adobe-fonts/source-han-serif>
- License: SIL Open Font License 1.1（见 `third_party/licenses/SourceHanSerif-OFL.txt`）
- Used as a self-hosted subset for UI titles in the embedded web app (family name `Mobi Title Serif`).

## npm dependencies

Runtime and build dependencies are listed in `package.json` / `pnpm-lock.yaml` (or `package-lock.json` in the public plugin repo). Each dependency remains under its own license. The Obsidian API typings (`obsidian`) are used only at build time.
