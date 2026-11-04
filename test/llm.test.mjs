// llm.test.mjs — ctx.llm 封装的契约测试（不需要 DSH，也不需要真实模型）。
//   node test/llm.test.mjs
import assert from 'node:assert/strict'

const { streamChat, completeText, translate, LlmUnavailable } = await import('../dist/llm.js')

let passed = 0
const check = (name, fn) => {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

/** 假 ctx：记录收到的请求，按需模拟拒绝/失败 */
function makeCtx({ rejectAssistant = false, finishError = false, aborted = false } = {}) {
  const seen = []
  return {
    seen,
    ctx: {
      agentDefaultModel: {
        currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' }),
      },
      llm: {
        stream(options) {
          seen.push(options)
          if (rejectAssistant && options.messages.some((m) => m.role === 'assistant')) {
            throw new Error('invalid message: assistant requires source.kind=model')
          }
          return (async function* () {
            yield { type: 'block-start', index: 0, blockType: 'text' }
            yield { type: 'text-delta', index: 0, text: '你好' }
            yield { type: 'text-delta', index: 0, text: '，世界' }
            if (finishError) yield { type: 'finish', reason: { kind: 'error', failure: { message: '额度不足' } } }
            else if (aborted) yield { type: 'finish', reason: { kind: 'aborted' } }
            else yield { type: 'finish', reason: { kind: 'stop' } }
          })()
        },
      },
    },
  }
}

const collect = async (iterable) => {
  let out = ''
  for await (const delta of iterable) out += delta
  return out
}

const single = makeCtx()
const singleOut = await completeText({ ctx: single.ctx, turns: [{ role: 'user', text: '你好' }] })
check('单轮：消息形状与路由参数', () => {
  assert.equal(singleOut, '你好，世界')
  const request = single.seen[0]
  assert.equal(request.provider, 'deepseek-official')
  assert.equal(request.model, 'deepseek-flash')
  assert.equal(request.reasoningEffort, 'high')
  assert.deepEqual(request.messages, [{ role: 'user', content: [{ type: 'text', text: '你好' }] }])
})

const multi = makeCtx()
await completeText({
  ctx: multi.ctx,
  turns: [
    { role: 'user', text: 'Q1' },
    { role: 'assistant', text: 'A1' },
    { role: 'user', text: 'Q2' },
  ],
})
check('多轮：原生 user/assistant 消息并带 source', () => {
  const roles = multi.seen[0].messages.map((m) => m.role)
  assert.deepEqual(roles, ['user', 'assistant', 'user'])
  assert.equal(multi.seen[0].messages[1].source.kind, 'model')
})

const fallback = makeCtx({ rejectAssistant: true })
const fallbackOut = await completeText({
  ctx: fallback.ctx,
  turns: [
    { role: 'user', text: 'Q1' },
    { role: 'assistant', text: 'A1' },
    { role: 'user', text: 'Q2' },
  ],
})
check('适配器拒绝 assistant 消息时回落到 transcript', () => {
  assert.equal(fallbackOut, '你好，世界')
  assert.equal(fallback.seen.length, 2)
  assert.ok(fallback.seen[1].messages[0].content[0].text.includes('【此前对话】'))
})

await assert.rejects(
  () => completeText({ ctx: makeCtx({ finishError: true }).ctx, turns: [{ role: 'user', text: 'x' }] }),
  (error) => {
    check('finish=error 转成可读错误', () => {
      assert.ok(error instanceof LlmUnavailable)
      assert.equal(error.message, '额度不足')
    })
    return true
  },
)

await assert.rejects(
  () => completeText({ ctx: makeCtx({ aborted: true }).ctx, turns: [{ role: 'user', text: 'x' }] }),
  (error) => {
    check('finish=aborted 抛中止', () => assert.equal(error.message, '已中止'))
    return true
  },
)

await assert.rejects(
  () => completeText({ ctx: { llm: { stream() {} } }, turns: [{ role: 'user', text: 'x' }] }),
  (error) => {
    check('没有 agentDefaultModel 时给出可读提示', () => {
      assert.ok(error instanceof LlmUnavailable)
      assert.match(error.message, /agentDefaultModel/)
    })
    return true
  },
)

await assert.rejects(
  () => completeText({ ctx: {}, turns: [{ role: 'user', text: 'x' }] }),
  (error) => {
    check('没有 llm 服务时给出可读提示', () => {
      assert.match(error.message, /llm/)
    })
    return true
  },
)

const tr = makeCtx()
const translated = await translate(tr.ctx, 'Einstein 1905', 'zh')
check('划词翻译：系统提示要求中文、低温', () => {
  assert.equal(translated, '你好，世界')
  assert.match(tr.seen[0].system, /Simplified Chinese/)
  assert.equal(tr.seen[0].temperature, 0.1)
})

const streamed = []
for await (const delta of streamChat({ ctx: makeCtx().ctx, turns: [{ role: 'user', text: 'x' }] })) {
  streamed.push(delta)
}
check('流式逐段吐出', () => assert.deepEqual(streamed, ['你好', '，世界']))

console.log(`llm.test: ${passed} passed`)
