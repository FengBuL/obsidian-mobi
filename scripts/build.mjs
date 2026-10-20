import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL(`../`, import.meta.url))
const outDir = `${root}dist/mobi/`
const packPath = join(root, `assets/mobi-offline.bin`)
const release = process.env.MOBI_OBSIDIAN_RELEASE === `1`
const sourcemap = release ? false : `inline`

// 离线包不再打进 main.js：作为单独的发布文件 mobi-offline.bin 上传，
// main.js 里只记录它的 SHA-256 和大小，首次使用离线版时下载并核对。
let sha256 = ``
let size = 0
if (existsSync(packPath)) {
  const bytes = await readFile(packPath)
  sha256 = createHash(`sha256`).update(bytes).digest(`hex`)
  size = bytes.length
}
if (release && !sha256)
  throw new Error(`发布构建需要 assets/mobi-offline.bin（离线包），没有找到`)

await mkdir(outDir, { recursive: true })
await build({
  entryPoints: [`${root}src/main.ts`],
  outfile: `${outDir}main.js`,
  bundle: true,
  external: [`obsidian`, `electron`, ...builtinModules, ...builtinModules.map(name => `node:${name}`)],
  format: `cjs`,
  target: `es2021`,
  sourcemap,
  logLevel: `info`,
  define: {
    __OFFLINE_PACK_SHA256__: JSON.stringify(sha256),
    __OFFLINE_PACK_SIZE__: String(size),
  },
})
for (const name of [`manifest.json`, `styles.css`])
  await copyFile(`${root}${name}`, `${outDir}${name}`)
process.stdout.write(`插件已构建：${outDir}${release ? `（发布模式，无 sourcemap）` : ``}；离线包 ${sha256 ? `sha256=${sha256} size=${size}` : `未附带`}\n`)
