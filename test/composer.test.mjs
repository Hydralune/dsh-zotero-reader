import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { writeFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const target = new URL(`./.composer-${process.pid}.mjs`, import.meta.url)
try {
  const result = await build({ stdin: { contents: "export * from '../src/client/dshComposer'; export {installNativeExplanation} from '../src/client/explain'; export {attachmentGroups} from '../src/client/components/ReaderAttachments'", resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'tsx' }, bundle: true,
    platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', write: false })
  await writeFile(target, result.outputFiles[0].contents)
  const composer = await import(target.href)
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
  const parts = { title: 'Paper title', page: 3, text: 'Selected source text', intent: 'quote' }
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
    fileUploads: { getSnapshot: () => ({ 'explain-0': { status: uploadStatus } }) },
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
  assert.equal(editor.value, draftBefore)
  assert.deepEqual(attachments, attachedBefore, 'Direct explanation must not consume the editor attachments')
  const explanationImage = new File(['image bytes'], 'explain.png', { type: 'image/png' })
  await composer.explainInDsh(parts, explanationImage)
  assert.equal(explanationCalls.length, 2)
  assert.equal(createdFiles[0], explanationImage)
  uploadStatus = 'error'
  await assert.rejects(composer.explainInDsh(parts), /上传失败/)
  assert.equal(explanationCalls.length, 2)
  assert.equal(released.length, 1)
  unbind(); stop()
  await assert.rejects(composer.explainInDsh(parts), /会话/)
  assert.equal(editor.value, '用户正在输入的问题')
  assert.equal(attachments.length, 1)
  assert.equal(attachments[0].type, 'text/plain')
  const content = await attachments[0].text()
  assert.ok(content.includes(parts.text) && content.includes(parts.title) && content.includes('页码：3'))
  assert.ok(content.includes('没有另外输入问题'))
  assert.ok(!attachments[0].name.includes('如果用户'))
  assert.equal(composer.attachmentGroups(attachments.map(file => ({ id: file.name, kind: 'file', file })))[0][1].reference.parts.text, parts.text)
  attachments = []
  const image = new File(['image bytes'], 'capture.png', { type: 'image/png' })
  assert.ok(composer.sendCaptureToDsh({ title: parts.title, page: 5, intent: 'ask' }, image))
  assert.deepEqual(attachments.map(file => file.type), ['image/png', 'text/plain'])
  const grouped = composer.attachmentGroups(attachments.map(file => ({ id: file.name, kind: file.type === 'image/png' ? 'image' : 'file', file })))
  assert.equal(grouped.length, 1)
  assert.ok(grouped[0][1].reference.screenshot)
  assert.equal(grouped[0][1].files.length, 2)
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
