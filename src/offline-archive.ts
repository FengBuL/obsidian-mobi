import { gunzipSync } from 'node:zlib'

const MAGIC = Buffer.from(`MOBIOL1\n`)

/** 把构建期打进 main.js 的离线归档解成 path → 内容 */
export function unpackOfflineArchive(archive: Uint8Array): Map<string, Uint8Array> {
  const buf = Buffer.from(archive)
  if (buf.length < MAGIC.length || !buf.subarray(0, MAGIC.length).equals(MAGIC))
    throw new Error(`离线包格式无效`)
  const body = gunzipSync(buf.subarray(MAGIC.length))
  const files = new Map<string, Uint8Array>()
  let offset = 0
  while (offset < body.length) {
    if (offset + 8 > body.length)
      throw new Error(`离线包已截断`)
    const pathLen = body.readUInt32BE(offset)
    const dataLen = body.readUInt32BE(offset + 4)
    offset += 8
    if (offset + pathLen + dataLen > body.length)
      throw new Error(`离线包已截断`)
    const path = body.subarray(offset, offset + pathLen).toString(`utf8`)
    offset += pathLen
    if (!path || path.includes(`\0`) || path.startsWith(`/`) || path.split(`/`).includes(`..`))
      throw new Error(`离线包路径无效：${path}`)
    files.set(path, new Uint8Array(body.subarray(offset, offset + dataLen)))
    offset += dataLen
  }
  return files
}

export function readOfflineVersion(files: Map<string, Uint8Array>): { appVersion?: string, builtAt?: string, telemetry?: boolean } | null {
  const raw = files.get(`VERSION.json`)
  if (!raw)
    return null
  try {
    return JSON.parse(Buffer.from(raw).toString(`utf8`)) as { appVersion?: string, builtAt?: string, telemetry?: boolean }
  }
  catch {
    return null
  }
}
