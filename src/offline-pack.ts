import type { OfflineVersionInfo } from './offline-archive'
import { readOfflineVersion, unpackOfflineArchive } from './offline-archive'

/** 发布时随 main.js 一起上传的离线包文件名，也是它在插件目录里的文件名 */
export const OFFLINE_PACK_FILE = `mobi-offline.bin`

/** 离线包的下载地址；只从本插件自己的 GitHub Release 下载，版本号取自 manifest */
export function offlinePackUrl(version: string): string {
  return `https://github.com/FengBuL/obsidian-mobi/releases/download/${version}/${OFFLINE_PACK_FILE}`
}

export interface ExpectedPack {
  /** 构建时算出的 SHA-256（小写十六进制）；空字符串表示这次构建没带离线包 */
  sha256: string
  size: number
}

/** 只用到 DataAdapter 的这几个方法，测试里可以用内存实现代替 */
export interface PackStorage {
  exists: (path: string) => Promise<boolean>
  readBinary: (path: string) => Promise<ArrayBuffer>
  writeBinary: (path: string, data: ArrayBuffer) => Promise<void>
  remove: (path: string) => Promise<void>
}

export interface LoadedPack {
  files: Map<string, Uint8Array>
  info: OfflineVersionInfo
  /** 这次是否刚下载 */
  downloaded: boolean
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(`SHA-256`, data as BufferSource)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, `0`)).join(``)
}

/** 大小和 SHA-256 都对得上才算数 */
export async function matchesExpected(data: ArrayBuffer, expected: ExpectedPack): Promise<boolean> {
  if (!expected.sha256 || data.byteLength !== expected.size)
    return false
  return (await sha256Hex(data)) === expected.sha256
}

export interface LoadPackOptions {
  storage: PackStorage
  /** 离线包在插件目录里的路径 */
  path: string
  expected: ExpectedPack
  download: () => Promise<ArrayBuffer>
}

/** 本地有且校验通过就直接用；没有或校验失败就重新下载、校验、落盘 */
export async function loadOfflinePack(options: LoadPackOptions): Promise<LoadedPack> {
  const { storage, path, expected } = options
  if (!expected.sha256)
    throw new Error(`这个插件版本没有附带离线包`)

  let data: ArrayBuffer | null = null
  let downloaded = false
  if (await storage.exists(path)) {
    const local = await storage.readBinary(path)
    if (await matchesExpected(local, expected))
      data = local
    else
      await storage.remove(path)
  }
  if (!data) {
    const fetched = await options.download()
    if (!(await matchesExpected(fetched, expected)))
      throw new Error(`下载的离线包校验失败（大小或 SHA-256 与插件内记录的不一致），已丢弃`)
    await storage.writeBinary(path, fetched)
    data = fetched
    downloaded = true
  }

  const files = unpackOfflineArchive(new Uint8Array(data))
  if (!files.has(`index.html`))
    throw new Error(`离线包里没有 index.html`)
  return { files, info: readOfflineVersion(files) ?? {}, downloaded }
}
