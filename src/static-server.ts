import http from 'node:http'

export interface StaticServer {
  host: `127.0.0.1`
  port: number
  close: () => Promise<void>
}

/** 离线包解开后的内容：相对路径 → 字节。服务只读内存，不碰磁盘 */
export type StaticFiles = Map<string, Uint8Array>

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf(`/`) + 1)
  const dot = name.lastIndexOf(`.`)
  return dot <= 0 ? `` : name.slice(dot).toLowerCase()
}

const MIME: Record<string, string> = {
  '.html': `text/html; charset=utf-8`,
  '.js': `text/javascript; charset=utf-8`,
  '.mjs': `text/javascript; charset=utf-8`,
  '.css': `text/css; charset=utf-8`,
  '.json': `application/json; charset=utf-8`,
  '.svg': `image/svg+xml`,
  '.png': `image/png`,
  '.jpg': `image/jpeg`,
  '.jpeg': `image/jpeg`,
  '.gif': `image/gif`,
  '.webp': `image/webp`,
  '.ico': `image/x-icon`,
  '.woff': `font/woff`,
  '.woff2': `font/woff2`,
  '.ttf': `font/ttf`,
  '.otf': `font/otf`,
  '.txt': `text/plain; charset=utf-8`,
  '.xml': `application/xml; charset=utf-8`,
  '.wasm': `application/wasm`,
  '.map': `application/json; charset=utf-8`,
}

function send(res: http.ServerResponse, status: number, body = ``) {
  res.writeHead(status, { 'Content-Type': `text/plain; charset=utf-8`, 'X-Content-Type-Options': `nosniff` })
  res.end(body)
}

/** URL 路径 → 内存归档里的相对路径；`/` 映射到 index.html；非法返回 null */
export function memoryPathOf(urlPath: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath)
  }
  catch {
    return null
  }
  if (decoded.includes(`\0`))
    return null
  const trimmed = decoded.split(`?`)[0].split(`#`)[0]
  const normalized = trimmed.replace(/^\/+/, ``)
  if (!normalized || normalized.endsWith(`/`))
    return normalized ? null : `index.html`
  if (normalized.split(`/`).includes(`..`))
    return null
  return normalized
}

function sendBytes(res: http.ServerResponse, req: http.IncomingMessage, data: Uint8Array, filePath: string) {
  res.writeHead(200, {
    'Content-Type': MIME[extensionOf(filePath)] ?? `application/octet-stream`,
    'Content-Length': data.byteLength,
    'Cache-Control': `no-cache`,
    'X-Content-Type-Options': `nosniff`,
  })
  if (req.method === `HEAD`) {
    res.end()
    return
  }
  res.end(Buffer.from(data))
}

/** 只监听 127.0.0.1。port 为 0 时由系统分配；端口被占用时 reject 带 code 的错误 */
export function createStaticServer(options: { files: StaticFiles, port: number }): Promise<StaticServer> {
  return new Promise((resolveServer, reject) => {
    let boundPort = options.port
    const server = http.createServer((req, res) => {
      // 防 DNS 重绑定：网页用别的域名解析到 127.0.0.1 来访问时，Host 头不会是我们的地址
      if (req.headers.host !== `127.0.0.1:${boundPort}`) {
        send(res, 403, `forbidden`)
        return
      }
      if (req.method !== `GET` && req.method !== `HEAD`) {
        send(res, 405, `method not allowed`)
        return
      }
      const pathname = (req.url ?? `/`).split(`?`)[0].split(`#`)[0]
      const rel = memoryPathOf(pathname)
      if (!rel) {
        send(res, 403, `forbidden`)
        return
      }
      const data = options.files.get(rel)
      if (!data) {
        send(res, 404, `not found`)
        return
      }
      sendBytes(res, req, data, rel)
    })
    server.once(`error`, reject)
    server.listen(options.port, `127.0.0.1`, () => {
      const address = server.address()
      boundPort = typeof address === `object` && address ? address.port : options.port
      server.removeListener(`error`, reject)
      resolveServer({
        host: `127.0.0.1`,
        port: boundPort,
        close: () => new Promise((done) => {
          server.close(() => done())
          server.closeAllConnections?.()
        }),
      })
    })
  })
}
