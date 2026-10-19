import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import http from 'node:http'
import { extname, join, resolve, sep } from 'node:path'

export interface StaticServer {
  host: `127.0.0.1`
  port: number
  close: () => Promise<void>
}

export type StaticFiles
  = | { kind: `disk`, root: string }
    | { kind: `memory`, files: Map<string, Uint8Array> }

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

/** 把请求路径解析成根目录内的绝对路径；落到根目录外、含空字节或无法解码返回 null */
function resolveInside(root: string, urlPath: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath)
  }
  catch {
    return null
  }
  if (decoded.includes(`\0`))
    return null
  const target = resolve(join(root, `.${decoded.startsWith(`/`) ? decoded : `/${decoded}`}`))
  return target === root || target.startsWith(root + sep) ? target : null
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
    'Content-Type': MIME[extname(filePath).toLowerCase()] ?? `application/octet-stream`,
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
      if (options.files.kind === `memory`) {
        const rel = memoryPathOf(pathname)
        if (!rel) {
          send(res, 403, `forbidden`)
          return
        }
        const data = options.files.files.get(rel)
        if (!data) {
          send(res, 404, `not found`)
          return
        }
        sendBytes(res, req, data, rel)
        return
      }

      const root = resolve(options.files.root)
      const file = resolveInside(root, pathname)
      if (!file) {
        send(res, 403, `forbidden`)
        return
      }
      void (async () => {
        try {
          let target = file
          let info = await stat(target)
          if (info.isDirectory()) {
            // 只有站点根目录回 index.html，其余目录不列内容
            if (pathname !== `/`) {
              send(res, 404, `not found`)
              return
            }
            target = join(target, `index.html`)
            info = await stat(target)
          }
          res.writeHead(200, {
            'Content-Type': MIME[extname(target).toLowerCase()] ?? `application/octet-stream`,
            'Content-Length': info.size,
            'Cache-Control': `no-cache`,
            'X-Content-Type-Options': `nosniff`,
          })
          if (req.method === `HEAD`) {
            res.end()
            return
          }
          createReadStream(target).on(`error`, () => res.destroy()).pipe(res)
        }
        catch {
          send(res, 404, `not found`)
        }
      })()
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
