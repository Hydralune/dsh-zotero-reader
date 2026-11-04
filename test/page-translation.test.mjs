import assert from 'node:assert/strict'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'zr-translation-'))
process.env.DSH_HOME = home
const { translatePage } = await import('../dist/page-translation.js')
const { writeSetup } = await import('../dist/setup.js')
await writeSetup({ translation: 'dsh' })
const page = (texts) => ({ page: 4, width: 600, height: 800,
  blocks: texts.map((text, index) => ({ id: `p4-${index}`, type: 'text', text, bbox: [.1, .1, .9, .2] })) })
const source = options => options.messages[0].content[0].text
const jsonUnits = options => JSON.parse(source(options))
function model(answer) {
  const seen = []
  const ctx = {
    agentDefaultModel: { currentSelection: () => ({ provider: 'test', model: 'test-translator' }) },
    llm: { stream: options => (async function* () {
      seen.push(options)
      const response = await answer(options, seen.length)
      yield { type: 'text-delta', text: typeof response === 'string' ? response : response.text }
      yield { type: 'finish', reason: { kind: typeof response === 'string' ? 'stop' : response.finish } }
    })() },
  }
  return { ctx, seen }
}
let passed = 0
async function check(name, fn) { await fn(); passed++; console.log(`  ✓ ${name}`) }
try {
  await check('带前言、代码围栏和额外说明的 JSON 可以恢复', async () => {
    const { ctx, seen } = model(() => 'Translation follows:\n```json\n{"p4-0":"这是译文，包含 {括号}。"}\n```\nDone.')
    const result = await translatePage(ctx, join(home, 'fences'), page(['An introduction.']))
    assert.equal(result['p4-0'], '这是译文，包含 {括号}。')
    assert.equal(seen.length, 1)
    assert.ok(seen[0].maxTokens >= 4096)
  })
  await check('数组格式与 translations 包装可以恢复', async () => {
    const { ctx } = model(() => JSON.stringify({ translations: [{ id: 'p4-0', translation: '译文甲' }, { id: 'p4-1', text: '译文乙' }] }))
    assert.deepEqual(await translatePage(ctx, join(home, 'array'), page(['First', 'Second'])), { 'p4-0': '译文甲', 'p4-1': '译文乙' })
  })
  await check('只重试漏译段落，不重复翻译已成功段落', async () => {
    const { ctx, seen } = model((_options, count) => count === 1 ? '{"p4-0":"甲"}' : '{"p4-1":"乙"}')
    assert.deepEqual(await translatePage(ctx, join(home, 'missing'), page(['First', 'Second'])), { 'p4-0': '甲', 'p4-1': '乙' })
    assert.equal(source(seen[1]), 'Second')
    assert.ok(seen[1].system.includes('without JSON'))
  })
  await check('无法输出 JSON 时，单段纯译文回退保留引用编号和公式', async () => {
    const { ctx, seen } = model((_options, count) => count === 1 ? 'not JSON' : '[1] 这是译文，公式为 $x_i=1$。')
    const result = await translatePage(ctx, join(home, 'plain'), page(['[1] Source with $x_i=1$.']))
    assert.equal(result['p4-0'], '[1] 这是译文，公式为 $x_i=1$。')
    assert.ok(seen[1].system.includes('without JSON'))
  })
  await check('模型截断被识别，并拆成更小批次恢复', async () => {
    const { ctx, seen } = model((options, count) => count === 1
      ? { text: '{"p4-0":"未完成', finish: 'length' }
      : JSON.stringify(Object.fromEntries(jsonUnits(options).map(unit => [unit.id, '恢复译文']))))
    const result = await translatePage(ctx, join(home, 'length'), page(['One', 'Two']))
    assert.equal(Object.keys(result).length, 2)
    assert.equal(seen.length, 3)
  })
  await check('超长单段真正拆分，最终仍按原块 ID 拼回', async () => {
    const { ctx, seen } = model(options => JSON.stringify(Object.fromEntries(jsonUnits(options).map(unit => [unit.id, '分段译文']))))
    const result = await translatePage(ctx, join(home, 'long'), page(['A sentence with inline math $x_i = 1$. '.repeat(350)]))
    assert.deepEqual(Object.keys(result), ['p4-0'])
    assert.ok(result['p4-0'].includes('\n'))
    assert.ok(seen.length > 1)
    for (const options of seen) for (const unit of jsonUnits(options)) {
      assert.ok(unit.text.length <= 2600)
      assert.equal((unit.text.match(/\$/g) ?? []).length % 2, 0)
    }
  })
  await check('请求失败后保留已译段落，下次重试从检查点继续', async () => {
    const input = page(['First', 'Second'])
    const dir = join(home, 'checkpoint')
    const failed = model((_options, count) => {
      if (count === 1) return '{"p4-0":"已保存译文"}'
      throw new Error('simulated network failure')
    })
    await assert.rejects(translatePage(failed.ctx, dir, input), /network/)
    assert.ok((await readdir(join(dir, 'translations'))).some(name => name.includes('partial')))
    const recovered = model(options => {
      assert.deepEqual(jsonUnits(options).map(unit => unit.id), ['p4-1'])
      return '{"p4-1":"重试译文"}'
    })
    assert.deepEqual(await translatePage(recovered.ctx, dir, input), { 'p4-0': '已保存译文', 'p4-1': '重试译文' })
    assert.equal(recovered.seen.length, 1)
    const cache = model(() => { throw Error('Cached page must not call the model') })
    assert.equal((await translatePage(cache.ctx, dir, input))['p4-0'], '已保存译文')
    assert.equal(cache.seen.length, 0)
  })
  await check('原图表格不送模型翻译', async () => {
    const { ctx, seen } = model(() => { throw Error('Image table must not call model') })
    const input = page(['Table text']); input.blocks[0].type = 'table'; input.blocks[0].crop = true
    assert.deepEqual(await translatePage(ctx, join(home, 'table'), input), {})
    assert.equal(seen.length, 0)
  })
  console.log(`page-translation.test: ${passed} passed`)
} finally { await rm(home, { recursive: true, force: true }) }
