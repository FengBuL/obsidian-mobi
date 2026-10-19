export interface MobiSettings {
  devUrl: string
  writeBack: boolean
  source: `online` | `offline`
  offlinePort: number
  /** 允许墨笔页面发送匿名使用统计（默认关闭；在线版通过 URL 参数传给页面） */
  allowTelemetry: boolean
}

export const DEFAULT_SETTINGS: MobiSettings = {
  devUrl: ``,
  writeBack: false,
  source: `online`,
  offlinePort: 0,
  allowTelemetry: false,
}

export function normalizeSettings(raw: unknown): MobiSettings {
  if (typeof raw !== `object` || raw === null)
    return { ...DEFAULT_SETTINGS }
  const { devUrl, writeBack, source, offlinePort, allowTelemetry } = raw as {
    devUrl?: unknown
    writeBack?: unknown
    source?: unknown
    offlinePort?: unknown
    allowTelemetry?: unknown
  }
  return {
    devUrl: typeof devUrl === `string` ? devUrl.trim() : ``,
    writeBack: writeBack === true,
    source: source === `offline` ? `offline` : `online`,
    offlinePort: typeof offlinePort === `number` && Number.isInteger(offlinePort) && offlinePort >= 1024 && offlinePort <= 65535 ? offlinePort : 0,
    allowTelemetry: allowTelemetry === true,
  }
}
