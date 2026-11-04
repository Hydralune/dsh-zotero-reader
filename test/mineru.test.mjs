import assert from 'node:assert/strict'
import { importMineru } from '../dist/mineru.js'
import { runPython } from '../dist/python.js'

const original = { version: 6, pageCount: 3, pages: [1, 2, 3].map(page => ({ page, width: 600, height: 800, blocks: [] })) }
const doc = importMineru([
  { type: 'equation', page_idx: 2, bbox: [100, 200, 500, 240] },
  { type: 'equation', page_idx: 2, bbox: [100, 300, 500, 340], text: '\\frac{a}{b}' },
  { type: 'image', page_idx: 2, bbox: [100, 400, 900, 800], img_caption: ['Figure 1'] },
], original)
assert.equal(doc.pages[0].blocks.length, 0)
assert.equal(doc.pages[2].blocks.length, 4)
assert.ok(doc.pages[2].blocks.slice(0, 3).every(block => block.crop))
assert.deepEqual(doc.pages[2].blocks[0].bbox, [.1, .2, .5, .24])
assert.equal(doc.pages[2].blocks[1].text, '\\frac{a}{b}')
assert.equal(doc.pages[2].blocks[3].type, 'caption')
console.log('MinerU: image-only formulas retained, formulas and figures cropped, original page index preserved')

const controller = new AbortController()
const started = Date.now()
const job = runPython(process.execPath, ['-e', 'setInterval(()=>{},1000)'], 15_000, { signal: controller.signal })
setTimeout(() => controller.abort(), 250)
const result = await job
assert.ok(result.aborted)
assert.equal(result.timedOut, false)
assert.ok(Date.now() - started < 10_000)
console.log('Parser cancellation: child process exits promptly')
