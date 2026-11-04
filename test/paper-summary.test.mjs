import assert from 'node:assert/strict'
import { build } from 'esbuild'

const bundle = await build({ entryPoints: ['src/client/paper-summary.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'reader-fixtures', setup(plugin) {
    plugin.onLoad({ filter: /[\\/]client[\\/]api\.ts$/ }, () => ({ contents: `export const pdfUrl=()=>'/fixture.pdf';export const getMarkdownBlocks=async()=>{if(globalThis.fixture.fail)throw Error('Not parsed');return globalThis.fixture.cached}`, loader: 'js' }))
    plugin.onLoad({ filter: /[\\/]viewer[\\/]pdf\.ts$/ }, () => ({ contents: `export const openPdf=async()=>({doc:{numPages:3,getData:async()=>new TextEncoder().encode('%PDF original bytes'),getPage:async(page)=>{globalThis.fixture.read.push(page);return {getTextContent:async()=>({items:page===3?[]:[{str:'Original page '+page,hasEOL:true}]})}}}})`, loader: 'js' }))
  } }] })
const summary = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].contents).toString('base64'))
const paper = { title: 'A generic empirical paper', file: '原论文.pdf', filePath: 'D:/研究/原论文.pdf', attachKey: 'ATTACH01', key: 'ITEMKEY1', creators: [] }
globalThis.fixture = { read: [], cached: { pages: [{ page: 1, blocks: [{ type: 'text', text: 'Full cached first page', bbox: [0, 0, 1, 1] }] }] } }
const stages = []
const result = await summary.preparePaperSummary(paper, 'My exact custom prompt', stage => stages.push(stage))
assert.equal(result.parts.question, 'My exact custom prompt')
assert.equal(result.parts.task, 'paper')
assert.equal(result.parts.source.pdfPath, paper.filePath)
assert.equal(result.document.name, paper.file)
assert.equal(result.document.type, 'application/pdf')
assert.equal(await result.document.text(), '%PDF original bytes')
assert.ok(result.parts.text.includes('Full cached first page'))
assert.ok(result.parts.text.includes('Original page 2'))
assert.ok(result.parts.text.includes('本页没有可提取文字'))
assert.deepEqual(result.parts.locations.map(item => item.page), [1, 2, 3])
assert.deepEqual(fixture.read.sort(), [2, 3], 'Use cached parsing and extract every uncached page')
assert.ok(stages.at(-1).includes('3/3'))
fixture.fail = true; fixture.read = []
const fallback = await summary.preparePaperSummary(paper, summary.DEFAULT_PAPER_PROMPT, () => {})
assert.deepEqual(fixture.read.sort(), [1, 2, 3])
assert.ok(fallback.parts.text.includes('Original page 1'))
for (let module = 0; module <= 9; module++) assert.match(summary.DEFAULT_PAPER_PROMPT, new RegExp(`\\n${module}\\. `))
assert.ok(summary.DEFAULT_PAPER_PROMPT.includes('20 字以内'))
assert.ok(summary.DEFAULT_PAPER_PROMPT.includes('约 150 字'))
assert.ok(summary.DEFAULT_PAPER_PROMPT.includes('智能体的 memory 译为「记忆」'))
assert.equal(summary.normalizeSummarySettings({ prompt: 'Custom', shortcut: '' }).shortcut, '')
assert.equal(summary.normalizeSummarySettings({ prompt: ' ', shortcut: 'bad' }).prompt, summary.DEFAULT_PAPER_PROMPT)
assert.equal(summary.shortcutFromEvent({ key: 's', altKey: true, shiftKey: true }), 'Alt+Shift+S')
assert.equal(summary.shortcutFromEvent({ key: 's' }), null)
console.log('Paper summary: complete PDF, all pages, cached/fallback extraction, custom prompt and shortcuts checked')
