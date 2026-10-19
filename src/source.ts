import type { MobiSettings } from './settings'
import { MOBI_ONLINE_ORIGIN, MOBI_ONLINE_URL } from './vendor/obsidian-protocol'

export interface AppSource {
  kind: `online` | `dev` | `offline`
  url: string
  origin: string
}

/** URL.origin 对自定义协议（如 app://）返回 "null"，这里用正则兜底 */
export function originOf(url: string): string {
  try {
    const { origin } = new URL(url)
    if (origin !== `null`)
      return origin
  }
  catch {
    return ``
  }
  return /^([a-z][a-z0-9+.-]*:\/\/[^/?#]+)/i.exec(url)?.[1] ?? ``
}

const LOOPBACK_HOSTS = new Set([`localhost`, `127.0.0.1`, `[::1]`])

/** 开发地址只接受回环主机上的 http(s) 地址，防止被填成任意站点后拿到笔记内容 */
function parseLoopbackUrl(text: string): URL | null {
  try {
    const url = new URL(text)
    const httpLike = url.protocol === `http:` || url.protocol === `https:`
    return httpLike && LOOPBACK_HOSTS.has(url.hostname) ? url : null
  }
  catch {
    return null
  }
}

function withHostParams(url: URL, pluginVersion: string, allowTelemetry: boolean): string {
  url.searchParams.set(`host`, `obsidian`)
  url.searchParams.set(`src`, `obsidian`)
  url.searchParams.set(`pv`, pluginVersion)
  url.searchParams.set(`telemetry`, allowTelemetry ? `on` : `off`)
  return url.toString()
}

export function resolveAppSource(settings: MobiSettings, pluginVersion: string): AppSource {
  const dev = settings.devUrl ? parseLoopbackUrl(settings.devUrl) : null
  if (dev) {
    const url = withHostParams(dev, pluginVersion, settings.allowTelemetry)
    return { kind: `dev`, url, origin: originOf(url) }
  }
  return {
    kind: `online`,
    url: withHostParams(new URL(MOBI_ONLINE_URL), pluginVersion, settings.allowTelemetry),
    origin: MOBI_ONLINE_ORIGIN,
  }
}

/** 离线构建：插件在本机回环端口上提供内置墨笔（P0 实测 app:// 下 iframe 的子资源会被 Obsidian 取消） */
export function resolveOfflineSource(port: number, pluginVersion: string, allowTelemetry = false): AppSource {
  const url = withHostParams(new URL(`http://127.0.0.1:${port}/`), pluginVersion, allowTelemetry)
  return { kind: `offline`, url, origin: `http://127.0.0.1:${port}` }
}
