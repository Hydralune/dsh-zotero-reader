// markdown.test.mjs — PDF → 结构化文本的端到端测试（需要本机 Python + PyMuPDF）。
//   node test/markdown.test.mjs [pdf路径]
// 没有样例 PDF 时会自己从 Zotero storage 里挑第一个，挑不到就跳过（exit 0）。
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import path from 'node:path'

const home = mkdtempSync(path.join(tmpdir(), 'zr-md-'))
process.env.DSH_HOME = home

const { startMarkdown, getMdJob, readMdDocument, readMdMarkdown, hasMd, mdKey } = await import('../dist/markdown.js')

/** 找一个体积合适的真实 PDF：优先命令行参数，其次 Zotero storage */
function findSample() {
  const explicit = process.argv[2]
  if (explicit && existsSync(explicit)) return explicit
  const storage = path.join(homedir(), 'Zotero', 'storage')
  if (!existsSync(storage)) return null
  for (const key of readdirSync(storage).slice(0, 40)) {
    const dir = path.join(storage, key)
    let files
    try {
      files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf'))
    } catch {
      continue
    }
    for (const file of files) {
      const full = path.join(dir, file)
      const size = statSync(full).size
      if (size > 100_000 && size < 6_000_000) return full
    }
  }
  return null
}

const sample = findSample()
if (!sample) {
  console.log('markdown.test: 跳过（没有可用样例 PDF，可用 node test/markdown.test.mjs <pdf> 指定）')
  rmSync(home, { recursive: true, force: true })
  process.exit(0)
}

const attachKey = 'TESTKEY1'
const file = path.basename(sample)
console.log(`  sample: ${file}`)

let passed = 0
const check = (name, fn) => {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const firstRun = await hasMd(attachKey, file)
check('首次没有缓存', () => {
  assert.equal(firstRun, false)
})

let job = await startMarkdown({ attachKey, file, pdfPath: sample, title: 'Test Paper' })
const started = performance.now()
while (job.status === 'running' && performance.now() - started < 120_000) {
  await new Promise((resolve) => setTimeout(resolve, 300))
  job = getMdJob(mdKey(attachKey, file))
}
check('解析任务完成', () => {
  assert.equal(job.status, 'done', job.error || job.stage)
  assert.ok(job.pages > 0, '页数应大于 0')
})

const doc = await readMdDocument(attachKey, file)
check('blocks.json 结构完整', () => {
  assert.ok(doc, 'blocks.json 应存在')
  assert.equal(doc.pageCount, doc.pages.length)
  const blocks = doc.pages.reduce((n, p) => n + p.blocks.length, 0)
  assert.ok(blocks > 0, '块数应大于 0')
  console.log(`     ${doc.pageCount} 页 / ${blocks} 块`)
})

check('所有 bbox 已归一化到 0..1', () => {
  for (const page of doc.pages) {
    for (const block of page.blocks) {
      assert.equal(block.bbox.length, 4)
      for (const value of block.bbox) {
        assert.ok(value >= 0 && value <= 1, `${block.id} bbox=${JSON.stringify(block.bbox)}`)
      }
    }
  }
})

check('块类型合法且标题有层级', () => {
  const kinds = new Set()
  for (const page of doc.pages) for (const block of page.blocks) kinds.add(block.type)
  for (const kind of kinds) {
    assert.ok(['title', 'text', 'list', 'table', 'figure', 'caption', 'equation'].includes(kind), `未知类型 ${kind}`)
  }
  const titles = doc.pages.flatMap((p) => p.blocks.filter((b) => b.type === 'title'))
  assert.ok(titles.length > 0, '应识别出标题')
  for (const title of titles) assert.ok(title.level >= 1 && title.level <= 4)
  console.log(`     类型: ${[...kinds].join(', ')} · 标题 ${titles.length} 个`)
})

const markdown = await readMdMarkdown(attachKey, file)
check('full.md 生成且含标题', () => {
  assert.ok(markdown && markdown.length > 500)
  assert.match(markdown, /^# /m)
  console.log(`     ${markdown.length} 字符`)
})

const again = await startMarkdown({ attachKey, file, pdfPath: sample })
check('二次调用命中缓存', () => {
  assert.equal(again.status, 'done')
  assert.equal(again.stage, '已解析')
})

rmSync(home, { recursive: true, force: true })
console.log(`markdown.test: ${passed} passed`)
