// llm.ts — 直接使用 DSH 自己的模型通道（ctx.llm + agentDefaultModel）。
//
// 为什么不再自带 provider/Key：DSH 已经有一等公民的模型路由（含凭据、重试、推理档），
// 插件再存一份 Key 就是**第二套配置**——用户要配两次、两处不一致、凭据还多落一份盘。
// 这里只做三件事：取当前选择、拼消息、把 chunk 摊平成文本流。
//
// 多轮：优先用原生 user/assistant 消息；如果宿主某版适配器不接受手工构造的 assistant
// 消息（缺内部字段），回落到「把历史编进一条 user 消息」，不至于让功能整个不可用。

import type { Context } from '@deepseek-ai/cordis'

export interface LlmTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface LlmRoute {
  provider: string
  model: string
  reasoningEffort?: string
}

interface LlmChunk {
  type: string
  text?: string
  reason?: { kind: string; failure?: { message?: string; code?: string } }
}

interface LlmService {
  stream(options: Record<string, unknown>): AsyncIterable<LlmChunk>
}

interface DefaultModelService {
  currentSelection(): { provider: string; model: string; reasoningEffort?: string }
}

export class LlmUnavailable extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LlmUnavailable'
  }
}

interface LlmContext {
  get?: (name: string) => unknown
  llm?: LlmService
  agentDefaultModel?: DefaultModelService
}

function services(ctx: Context): { llm: LlmService; route: LlmRoute } {
  // Cordis 里推荐 ctx.get(name)（可选依赖），属性访问在同作用域下不一定挂上
  const c = ctx as unknown as LlmContext
  const lookup = (name: 'llm' | 'agentDefaultModel') => {
    const viaGet = typeof c.get === 'function' ? c.get(name) : undefined
    return (viaGet ?? c[name]) as LlmService & DefaultModelService | undefined
  }
  const llm = lookup('llm') as LlmService | undefined
  const model = lookup('agentDefaultModel') as DefaultModelService | undefined
  if (!llm) throw new LlmUnavailable('当前会话没有 llm 服务（profile 里缺模型插件）')
  if (!model) throw new LlmUnavailable('当前会话没有 agentDefaultModel 服务')
  const selection = model.currentSelection()
  if (!selection?.provider || !selection?.model) {
    throw new LlmUnavailable('还没选择模型：请在 DSH 底部的模型选择器里选一个再试')
  }
  return {
    llm,
    route: {
      provider: selection.provider,
      model: selection.model,
      ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}),
    },
  }
}

export function getTranslationRoute(ctx: Context): LlmRoute {
  return services(ctx).route
}

type Message = Record<string, unknown>

function textBlock(text: string) {
  return [{ type: 'text', text }]
}

/** 原生多轮消息 */
function nativeMessages(turns: LlmTurn[], route: LlmRoute): Message[] {
  return turns.map((turn, index) =>
    turn.role === 'user'
      ? { role: 'user', content: textBlock(turn.text) }
      : {
          role: 'assistant',
          // 适配器只读 content；id/source 按 Message 契约补齐，避免某版适配器做严格校验时炸
          id: `zr-${index}`,
          source: { kind: 'model', provider: route.provider, model: route.model },
          content: textBlock(turn.text),
        },
  )
}

/** 回落形态：把历史压进一条 user 消息 */
function transcriptMessages(turns: LlmTurn[]): Message[] {
  if (turns.length <= 1) {
    return [{ role: 'user', content: textBlock(turns[turns.length - 1]?.text ?? '') }]
  }
  const history = turns
    .slice(0, -1)
    .map((t) => `${t.role === 'user' ? '用户' : '助手'}：${t.text}`)
    .join('\n\n')
  const last = turns[turns.length - 1]
  return [
    {
      role: 'user',
      content: textBlock(`【此前对话】\n${history}\n\n【本次提问】\n${last.text}`),
    },
  ]
}

export interface ChatOptions {
  ctx: Context
  turns: LlmTurn[]
  system?: string
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
  route?: LlmRoute
}

async function* run(ctx: Context, options: ChatOptions, messages: Message[]): AsyncIterable<string> {
  const { llm, route } = services(ctx)
  const stream = llm.stream({
    ...(options.route ?? route),
    messages,
    ...(options.system ? { system: options.system } : {}),
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
    ...(options.signal ? { signal: options.signal } : {}),
  })
  for await (const chunk of stream) {
    if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
      yield chunk.text
    } else if (chunk.type === 'finish') {
      const kind = chunk.reason?.kind
      if (kind === 'error') throw new LlmUnavailable(chunk.reason?.failure?.message || '模型返回错误')
      if (kind === 'aborted') throw new LlmUnavailable('已中止')
      if (kind && ['length', 'max-tokens', 'max_tokens', 'max-output-tokens'].includes(kind)) {
        throw new LlmUnavailable('模型输出达到长度上限，译文已截断')
      }
    }
  }
}

/** 流式对话：逐段吐出文本 */
export async function* streamChat(options: ChatOptions): AsyncIterable<string> {
  const route = options.route ?? services(options.ctx).route
  try {
    yield* run(options.ctx, options, nativeMessages(options.turns, route))
  } catch (error) {
    // 只有在「还没吐出任何内容」时才回落，避免重复输出
    const message = error instanceof Error ? error.message : String(error)
    if (options.turns.length > 1 && /message|role|source|content/i.test(message)) {
      yield* run(options.ctx, options, transcriptMessages(options.turns))
      return
    }
    throw error
  }
}

/** 一次性取全文（翻译、摘要） */
export async function completeText(options: ChatOptions): Promise<string> {
  let out = ''
  for await (const delta of streamChat(options)) out += delta
  return out.trim()
}

/* ------------------------------------------------------------------ */
/* 提示词                                                              */
/* ------------------------------------------------------------------ */

const TRANSLATE_SYSTEM = `You are a precise academic translator working on research papers.
Rules:
- Preserve LaTeX/math verbatim ($...$, $$...$$, \\cite{}, \\ref{}).
- Preserve citation markers, figure/table numbers, and units exactly.
- Keep terminology consistent with the field; do not add explanations.
- Output ONLY the translation: no preamble, no quotes, no "译文：" prefix.`

export function translate(ctx: Context, text: string, to: 'zh' | 'en', signal?: AbortSignal): Promise<string> {
  return completeText({
    ctx,
    system: `${TRANSLATE_SYSTEM}\nTarget language: ${to === 'zh' ? 'Simplified Chinese' : 'English'}.`,
    turns: [{ role: 'user', text }],
    temperature: 0.1,
    signal,
  })
}
