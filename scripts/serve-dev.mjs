// serve-dev.mjs — 本地静态服务，给 test/harness.html 这类不依赖 DSH 的验证页用。
// 存在的唯一理由：Python 的 http.server 会给 .mjs 发 text/plain，ESM 导入会被浏览器拒绝。
// 用法：node scripts/serve-dev.mjs [port]
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.argv[2] || 8791)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
}

http
  .createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://x')
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')

    // 预览页（test/preview.html）跑的是真组件，它按插件真实路径取资源：
    //   /lr-reader/vendor/*         → vendor/*
    //   /lr-reader/api/zotero/file  → test/sample.pdf
    if (rel.startsWith('lr-reader/vendor/')) rel = 'vendor/' + rel.slice('lr-reader/vendor/'.length)
    else if (rel === 'lr-reader/api/zotero/file') rel = 'test/sample.pdf'
    const file = path.resolve(root, rel)
    if (!file.startsWith(root)) {
      res.writeHead(403).end('forbidden')
      return
    }
    fs.stat(file, (err, stat) => {
      if (err || !stat.isFile()) {
        res.writeHead(404).end('not found')
        return
      }
      res.writeHead(200, {
        'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'content-length': stat.size,
        'cache-control': 'no-store',
      })
      fs.createReadStream(file).pipe(res)
    })
  })
  .listen(port, '127.0.0.1', () => {
    console.log(`serve-dev: http://127.0.0.1:${port}/  (root: ${root})`)
  })
