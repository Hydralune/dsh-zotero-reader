// notes.test.mjs — 高亮/笔记存储的回归测试（直接跑编译产物，不需要 DSH）。
//   node test/notes.test.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const home = mkdtempSync(path.join(tmpdir(), 'zr-notes-'))
process.env.DSH_HOME = home

const { addMarks, readMarks, removeMark, updateMark, toMarkdown, notesPath, NotesError } = await import(
  '../dist/notes.js'
)

const KEY = 'ABCD1234'
const FILE = 'Paper - Test.pdf'
const rect = { x: 0.1, y: 0.2, w: 0.3, h: 0.02 }
let passed = 0
const check = (name, fn) => {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

check('路径按附件 key 归档', () => {
  assert.equal(notesPath(KEY, FILE).includes(KEY), true)
})

let marks = await addMarks(KEY, FILE, [
  { kind: 'highlight', color: '#ffeb3b', page: 2, rects: [rect], text: '第一条' },
  { kind: 'underline', color: '#2196f3', page: 1, rects: [rect, { ...rect, y: 0.3 }], text: '下划线' },
])
check('追加两条并按页保存', () => {
  assert.equal(marks.length, 2)
  assert.deepEqual(
    marks.map((m) => `${m.kind}@p${m.page}`),
    ['highlight@p2', 'underline@p1'],
  )
})

marks = await addMarks(KEY, FILE, [
  { kind: 'strike', color: '#f44336', page: 3, rects: [{ x: 0.95, y: 0.9, w: 0.5, h: 0.5 }, { x: 0.1, y: 0.1, w: 0, h: 0 }], text: '越界' },
])
const clamped = marks[marks.length - 1]
check('越界矩形被夹到页面内、零面积被丢弃', () => {
  assert.equal(clamped.rects.length, 1)
  const r = clamped.rects[0]
  assert.ok(r.x + r.w <= 1.0001 && r.y + r.h <= 1.0001, JSON.stringify(r))
})

marks = await addMarks(KEY, FILE, [
  { kind: 'garbage', color: 'javascript:alert(1)', page: 1, rects: [rect], text: 'sanitize' },
  { kind: 'highlight', color: '#ffeb3b', page: 0, rects: [rect], text: 'bad page' },
])
check('非法形态/颜色归一，非法页码丢弃', () => {
  assert.equal(marks.length, 4)
  const sanitized = marks.find((m) => m.text === 'sanitize')
  assert.equal(sanitized.kind, 'highlight')
  assert.equal(sanitized.color, '#ffeb3b')
  assert.equal(marks.filter((m) => m.text === 'bad page').length, 0)
})

const target = marks.find((m) => m.text === 'sanitize')
marks = await updateMark(KEY, FILE, target.id, { color: '#2196f3' })
check('改色', () => assert.equal(marks.find((m) => m.id === target.id).color, '#2196f3'))

marks = await updateMark(KEY, FILE, target.id, { kind: 'underline' })
check('改形态且颜色保留', () => {
  const m = marks.find((x) => x.id === target.id)
  assert.equal(m.kind, 'underline')
  assert.equal(m.color, '#2196f3')
})

marks = await updateMark(KEY, FILE, target.id, { color: 'nope', kind: 'nope' })
check('非法值被忽略', () => {
  const m = marks.find((x) => x.id === target.id)
  assert.equal(m.kind, 'underline')
  assert.equal(m.color, '#2196f3')
})

try {
  await updateMark(KEY, FILE, 'not-exist', { color: '#000000' })
  throw new Error('应当抛错')
} catch (error) {
  check('改不存在的标记抛 404', () => {
    assert.ok(error instanceof NotesError)
    assert.equal(error.status, 404)
  })
}

const persisted = await readMarks(KEY, FILE)
check('落盘可读', () => assert.equal(persisted.length, marks.length))

marks = await removeMark(KEY, FILE, target.id)
check('删除一条', () => assert.equal(marks.length, persisted.length - 1))

const md = toMarkdown('Test', marks)
check('Markdown 导出按页分组', () => {
  assert.ok(md.startsWith('# Test'))
  assert.ok(md.includes('## p.1'))
  assert.ok(md.includes('> 下划线'))
})

rmSync(home, { recursive: true, force: true })
console.log(`notes.test: ${passed} passed`)
