export interface Listening {
  port: number
  close: () => Promise<void>
}

export interface PickPortOptions {
  /** 设置里存下的端口，0 表示没存过 */
  saved: number
  random: () => number
  listen: (port: number) => Promise<Listening>
}

const MIN_PORT = 49152
const MAX_PORT = 65535
const MAX_ATTEMPTS = 10

function randomPort(random: () => number): number {
  return MIN_PORT + Math.floor(random() * (MAX_PORT - MIN_PORT + 1))
}

/**
 * 先试存下的端口，被占用就随机换。返回 changed 表示「存过端口但这次用不了」，
 * 调用方要提醒用户：端口变了，墨笔里的本地数据（稿子、AI Key、主题）会看起来丢了。
 */
export async function pickPort(options: PickPortOptions): Promise<Listening & { changed: boolean }> {
  let lastError: unknown
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const port = attempt === 0 && options.saved ? options.saved : randomPort(options.random)
    try {
      const listening = await options.listen(port)
      return { ...listening, changed: options.saved !== 0 && port !== options.saved }
    }
    catch (error) {
      lastError = error
      if ((error as { code?: string }).code !== `EADDRINUSE`)
        throw error
    }
  }
  throw lastError
}

export interface StartOfflineOptions extends PickPortOptions {
  save: (port: number) => Promise<void>
}

/** 选端口、起服务；端口和设置里的不一致时保存新端口。notice 是需要告诉用户的话，没有则为 null */
export async function startOfflineServer(options: StartOfflineOptions): Promise<Listening & { notice: string | null }> {
  const picked = await pickPort(options)
  if (picked.port !== options.saved)
    await options.save(picked.port)
  return {
    port: picked.port,
    close: picked.close,
    notice: picked.changed
      ? `离线版的端口 ${options.saved} 被占用，已改用 ${picked.port}。端口变了等于换了一个来源，墨笔里的稿子、AI Key 和主题在新端口下是空的；旧数据还在，端口空出来后在设置里把「离线端口」改回 ${options.saved}，再关闭并重新打开本插件即可`
      : null,
  }
}
