import type { ExpectedPack } from './offline-pack'

declare const __OFFLINE_PACK_SHA256__: string | undefined
declare const __OFFLINE_PACK_SIZE__: number | undefined

/** 构建脚本把 assets/mobi-offline.bin 的 SHA-256 和大小写进 main.js；没带离线包的构建里是空值 */
export const EXPECTED_OFFLINE_PACK: ExpectedPack = {
  sha256: typeof __OFFLINE_PACK_SHA256__ === `string` ? __OFFLINE_PACK_SHA256__ : ``,
  size: typeof __OFFLINE_PACK_SIZE__ === `number` ? __OFFLINE_PACK_SIZE__ : 0,
}
