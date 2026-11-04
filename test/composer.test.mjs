import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { writeFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const target = new URL(`./.composer-${process.pid}.mjs`, import.meta.url)
try {
  const result = await build({ stdin: { contents: "export * from '../src/client/dshComposer'; export * from '../src/client/viewer/quote-context'; export {installNativeExplanation} from '../src/client/explain'; export {attachmentGroups} from '../src/client/components/ReaderAttachments'", resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'tsx' }, bundle: true,
    platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', write: false })
  await writeFile(target, result.outputFiles[0].contents)
  const composer = await import(target.href)
  const longParagraph = 'Full original paragraph. '.repeat(600)
  const blocks = [3, 4].map(page => ({ id: `zr-block-p${page}`, dataset: { sourceBbox: '[0.1,0.2,0.8,0.4]' },
    closest: () => ({ dataset: { textPage: String(page) } }),
    querySelector: selector => ({ textContent: selector.includes('original') ? longParagraph : `中文译文 ${page}` }),
    getBoundingClientRect: () => ({ left: 0, right: 100, top: (page - 3) * 100, bottom: (page - 3) * 100 + 80 }),
  }))
  const textRoot = { querySelectorAll: () => blocks }
  const selectedContext = composer.textSelectionContext(textRoot, [{ block: 'p3', side: 'translation', start: 2, end: 6, quote: '中文译文' },
    { block: 'p4', side: 'original', start: 0, end: 15, quote: 'Full original' }])
  assert.deepEqual(selectedContext.locations.map(location => location.page), [3, 4])
  assert.ok(selectedContext.context.includes(longParagraph.trim()), 'Do not truncate full source paragraphs')
  assert.ok(selectedContext.context.includes('中文译文 3'), 'Translated selections retain their original and translation')
  const cropContext = composer.textCaptureContext(textRoot, { left: 10, right: 80, top: 20, bottom: 60 })
  assert.deepEqual(cropContext.locations.map(location => location.page), [3])
  assert.ok(cropContext.context.includes(longParagraph.trim()))
  class Editor extends EventTarget {
    value = '用户正在输入的问题'
    closest() { return null }
    focus() { document.activeElement = this }
  }
  const editor = new Editor()
  globalThis.document = { querySelectorAll: () => [editor] }
  globalThis.DataTransfer = class {
    files = []
    items = { add: file => { this.files.push(file) } }
  }
  globalThis.ClipboardEvent = class extends Event {
    constructor(type, options) { super(type, options); this.clipboardData = options.clipboardData }
  }
  const paper = { key: 'ITEMKEY1', attachKey: 'ATTACH01', file: '论文 original.pdf',
    filePath: 'C:\\Users\\测试 用户\\Zotero\\storage\\ATTACH01\\论文 original.pdf',
    creators: [{ firstName: 'Ada', lastName: 'Lovelace' }], year: '2026', doi: '10.1234/test', venue: 'Journal' }
  const source = composer.paperSource(paper)
  assert.equal(source.pdfPath, paper.filePath)
  assert.equal(composer.paperSource(paper, '论文 original-dual.pdf').pdfPath, paper.filePath.replace(/[^\\/]+$/, '论文 original-dual.pdf'))
  assert.equal(composer.paperSource(paper, '论文 original-dual.pdf').originalPdfPath, paper.filePath)
  const parts = { source, title: 'Paper title', page: 3, text: 'Selected source text', intent: 'quote',
    locations: [{ page: 3, rects: [{ x: .1, y: .2, w: .3, h: .04 }] }, { page: 4, block: 'block-4' }],
    context: 'The full original paragraph and its translation.' }
  const assertSource = content => {
    assert.ok(content.includes(JSON.stringify(paper.filePath)), 'Absolute PDF path must reach the model')
    for (const value of [paper.key, paper.attachKey, paper.doi, 'Ada Lovelace', parts.context, parts.text, JSON.stringify(parts.locations), '不要按论文标题']) assert.ok(content.includes(value), value)
  }
  let attachments = []
  const accept = event => { assert.equal(document.activeElement, editor, 'Focus must precede the native paste command'); event.preventDefault(); attachments.push(...event.clipboardData.files) }
  editor.addEventListener('paste', accept)
  composer.previewDshQuote(parts)
  assert.equal(composer.getQuotePreview().parts.text, parts.text)
  assert.ok(composer.sendToDsh(parts))
  assert.equal(composer.getQuotePreview(), null)
  const explanationCalls = [], released = []
  let uploadStatus = 'ready'
  let createdFiles = []
  const binding = { session: { id: 'SESSION' } }
  const conversation = {
    createDrafts: (_id, files) => { createdFiles = files; return files.map((_, index) => ({ id: 'explain-' + index })) },
    fileUploads: { getSnapshot: () => Object.fromEntries(createdFiles.flatMap((file, index) => file.type.startsWith('image/') ? [] : [['explain-' + index, { status: uploadStatus }]])) },
    sendSession: async (...args) => { explanationCalls.push(args); return { kind: 'success' } },
    releaseDraftAttachments: files => released.push(files),
  }
  const stop = composer.installNativeExplanation({ get: name => name === 'sessions' ? { binding: () => binding } : conversation })
  const unbind = composer.bindExplanationComposer(editor, 'SESSION')
  const draftBefore = editor.value, attachedBefore = [...attachments]
  await composer.explainInDsh(parts)
  assert.equal(explanationCalls.length, 1)
  assert.equal(explanationCalls[0][0], binding.session)
  assert.match(explanationCalls[0][1], /解释.*Paper title/)
  assert.equal(explanationCalls[0][3], 'queue')
  assert.ok((await createdFiles[0].text()).includes(parts.text))
  assertSource(await createdFiles[0].text())
  assert.equal(editor.value, draftBefore)
  assert.deepEqual(attachments, attachedBefore, 'Direct explanation must not consume the editor attachments')
  const explanationImage = new File(['image bytes'], 'explain.png', { type: 'image/png' })
  await composer.explainInDsh(parts, explanationImage)
  assert.equal(explanationCalls.length, 2)
  assert.equal(createdFiles[0], explanationImage)
  assert.equal(createdFiles.length, 2, 'Direct screenshot explanation also needs its source document')
  assertSource(await createdFiles[1].text())
  assert.deepEqual(explanationCalls[1][2], ['explain-0', 'explain-1'])
  const summaryPdf = new File(['%PDF-1.7 complete document'], paper.file, { type: 'application/pdf' })
  const summaryParts = { ...parts, task: 'paper', question: 'Custom full-paper analysis rules', page: undefined }
  composer.previewDshQuote(parts)
  await composer.explainPreparedInDsh(async () => ({ parts: summaryParts, document: summaryPdf }))
  assert.equal(explanationCalls.length, 3)
  assert.equal(createdFiles[0], summaryPdf)
  assert.equal(createdFiles.length, 2)
  assert.ok((await createdFiles[1].text()).includes(summaryParts.question))
  assert.match(explanationCalls[2][1], /完整论文/)
  assert.ok(!explanationCalls[2][1].includes(summaryParts.question), 'Keep the full prompt inside the source attachment')
  assert.equal(editor.value, draftBefore)
  assert.deepEqual(attachments, attachedBefore)
  assert.ok(composer.getQuotePreview(), 'Summarizing the paper must preserve an unrelated pending quote')
  uploadStatus = 'error'
  await assert.rejects(composer.explainInDsh(parts), /上传失败/)
  assert.equal(explanationCalls.length, 3)
  assert.equal(released.length, 1)
  unbind(); stop()
  await assert.rejects(composer.explainInDsh(parts), /会话/)
  assert.equal(editor.value, '用户正在输入的问题')
  assert.equal(attachments.length, 1)
  assert.equal(attachments[0].type, 'text/plain')
  const content = await attachments[0].text()
  assertSource(content)
  assert.ok(content.includes(parts.text) && content.includes(parts.title) && content.includes('页码：3'))
  assert.ok(content.includes('没有另外输入问题'))
  assert.ok(!attachments[0].name.includes('如果用户'))
  assert.equal(composer.attachmentGroups(attachments.map(file => ({ id: file.name, kind: 'file', file })))[0][1].reference.parts.text, parts.text)
  attachments = []
  const image = new File(['image bytes'], 'capture.png', { type: 'image/png' })
  assert.ok(composer.sendCaptureToDsh({ ...parts, page: 5, intent: 'ask' }, image))
  assert.deepEqual(attachments.map(file => file.type), ['image/png', 'text/plain'])
  const grouped = composer.attachmentGroups(attachments.map(file => ({ id: file.name, kind: file.type === 'image/png' ? 'image' : 'file', file })))
  assert.equal(grouped.length, 1)
  assert.ok(grouped[0][1].reference.screenshot)
  assert.equal(grouped[0][1].files.length, 2)
  assertSource(await attachments[1].text())
  assert.equal(editor.value, '用户正在输入的问题')
  editor.removeEventListener('paste', accept)
  composer.previewDshQuote(parts)
  assert.equal(composer.sendToDsh(parts), false)
  assert.ok(composer.getQuotePreview())
  editor.addEventListener('paste', accept)
  composer.previewDshCapture(parts, Promise.resolve(new Blob(['image bytes'], { type: 'image/png' })))
  assert.ok(composer.getQuotePreview().image)
  assert.ok(await composer.confirmDshQuote())
  assert.equal(composer.getQuotePreview(), null)
  console.log('Composer: references, screenshot grouping, direct text/image explanation, isolated drafts, and failed-upload cleanup checked')
} finally { await rm(target, { force: true }) }
