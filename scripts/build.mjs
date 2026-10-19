import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL(`../`, import.meta.url))
const outDir = `${root}dist/mobi/`
const archivePath = join(root, `assets/mobi-offline.bin`)
const release = process.env.MOBI_OBSIDIAN_RELEASE === `1`
const sourcemap = release ? false : `inline`

await mkdir(outDir, { recursive: true })
await mkdir(join(root, `assets`), { recursive: true })
if (!existsSync(archivePath))
  await writeFile(archivePath, Buffer.alloc(0))

await build({
  entryPoints: [`${root}src/main.ts`],
  outfile: `${outDir}main.js`,
  bundle: true,
  external: [`obsidian`, `electron`, ...builtinModules, ...builtinModules.map(name => `node:${name}`)],
  format: `cjs`,
  target: `es2021`,
  sourcemap,
  logLevel: `info`,
  plugins: [{
    name: `offline-bundle`,
    setup(api) {
      api.onResolve({ filter: /^virtual:offline-bundle$/ }, () => ({
        path: `virtual:offline-bundle`,
        namespace: `offline-bundle`,
      }))
      api.onLoad({ filter: /.*/, namespace: `offline-bundle` }, async () => {
        const contents = existsSync(archivePath) ? await readFile(archivePath) : Buffer.alloc(0)
        return { contents, loader: `binary`, resolveDir: dirname(archivePath) }
      })
    },
  }],
})
for (const name of [`manifest.json`, `styles.css`])
  await copyFile(`${root}${name}`, `${outDir}${name}`)
process.stdout.write(`插件已构建：${outDir}${release ? `（发布模式，无 sourcemap）` : ``}\n`)
