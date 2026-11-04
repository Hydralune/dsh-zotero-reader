// preview-entry.tsx — 假后端 + 真组件：在没有 DSH 登录态时把阅读器整块渲染出来。
//
// 这不是「另写一套 UI」：它 import 的就是 src/client/ReaderPage.tsx，
// 只是把 /lr-reader/api/* 的 fetch 换成内存实现，PDF 与 vendor 由 serve-dev 提供。
// 用途：验证布局、交互、流式渲染、高亮落点、文本视图——也就是自动化测不到的那层。
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ReaderPane } from '../src/client/ReaderPane'

/* 采集运行时错误与 console，便于无头检查 */
const logs: string[] = []
const record = (kind: string, args: unknown[]) => {
  logs.push(`[${kind}] ` + args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : String(a))).join(' '))
}
for (const kind of ['warn', 'error'] as const) {
  const original = console[kind].bind(console)
  console[kind] = (...args: unknown[]) => {
    record(kind, args)
    original(...args)
  }
}
window.addEventListener('error', (e) => record('window.error', [e.message]))
window.addEventListener('unhandledrejection', (e) => record('unhandled', [e.reason]))
;(window as unknown as Record<string, unknown>).__logs = logs

const PAPER = {
  itemID: 1,
  key: 'ITEMKEY1',
  title: 'Memory Poisoning Attack and Defense on Memory-Based LLM-Agents',
  creators: [{ lastName: 'Sunil', firstName: 'Balachandra' }],
  year: '2026',
  venue: 'arXiv:2601.05504',
  collections: ['默认专题'],
  attachKey: 'TESTKEY1',
  file: 'sample.pdf',
  variants: [],
}

/** 假后端里的全部状态 */
const state = {
  marks: [] as Array<Record<string, unknown>>,
}

const MD = {
  version: 1,
  title: PAPER.title,
  pageCount: 2,
  pages: [
    {
      page: 1,
      width: 612,
      height: 792,
      blocks: [
        { id: 'p1-0', type: 'title', level: 1, bbox: [0.19, 0.12, 0.81, 0.18], text: 'Memory Poisoning Attack and Defense on Memory-Based LLM-Agents' },
        { id: 'p1-1', type: 'text', bbox: [0.19, 0.2, 0.81, 0.24], text: 'Balachandra Devarangadi Sunil, Isheeta Sinha, Piyush Maheshwari' },
        { id: 'p1-2', type: 'title', level: 3, bbox: [0.19, 0.26, 0.35, 0.28], text: 'Abstract' },
        {
          id: 'p1-3',
          type: 'text',
          bbox: [0.19, 0.3, 0.81, 0.46],
          text: 'Large language model agents equipped with persistent memory are vulnerable to memory poisoning attacks, where adversaries inject malicious instructions…',
        },
        { id: 'p1-4', type: 'list', bbox: [0.19, 0.48, 0.81, 0.56], text: '1. Initial memory state\n2. Number of indication prompts\n3. Retrieval parameters' },
        { id: 'p1-5', type: 'figure', bbox: [0.19, 0.58, 0.81, 0.7], text: '' },
        { id: 'p1-6', type: 'caption', bbox: [0.19, 0.71, 0.81, 0.73], text: 'Figure 1: Attack pipeline overview.' },
      ],
    },
    {
      page: 2,
      width: 612,
      height: 792,
      blocks: [
        { id: 'p2-0', type: 'title', level: 3, bbox: [0.19, 0.1, 0.45, 0.12], text: '1 Introduction' },
        { id: 'p2-1', type: 'text', bbox: [0.19, 0.14, 0.81, 0.26], text: 'Agents retrieve historical examples as few-shot demonstrations, which introduces a critical security vulnerability.' },
        {
          id: 'p2-2',
          type: 'table',
          bbox: [0.19, 0.28, 0.81, 0.42],
          text: '| Model | ASR | Utility |\n| --- | --- | --- |\n| GPT-4o-mini | 95% | 0.82 |\n| Gemini-2.0-Flash | 88% | 0.79 |',
        },
        { id: 'p2-3', type: 'text', bbox: [0.19, 0.44, 0.81, 0.52], text: 'Sanitization requires careful trust threshold calibration: $T = \\frac{1}{n}\\sum_i w_i s_i$ keeps recall high.' },
      ],
    },
  ],
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const realFetch = window.fetch.bind(window)

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const parsed = new URL(url, location.origin)
  const path = parsed.pathname
  const method = (init?.method ?? 'GET').toUpperCase()

  if (path === '/lr-reader/api/zotero/library') {
    return json({
      zoteroDir: 'C:/Fake/Zotero',
      collections: [{ collectionID: 1, name: '默认专题', parentID: null, itemCount: 1 }],
      papers: [PAPER],
      total: 1,
    })
  }

  if (path === '/lr-reader/api/notes') {
    if (method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { marks?: Array<Record<string, unknown>> }
      state.marks.push(...(body.marks ?? []))
      return json({ marks: state.marks })
    }
    if (method === 'PATCH') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { id: string; color?: string; kind?: string }
      state.marks = state.marks.map((m) => (m.id === body.id ? { ...m, color: body.color ?? m.color, kind: body.kind ?? m.kind } : m))
      return json({ marks: state.marks })
    }
    if (method === 'DELETE') {
      const id = parsed.searchParams.get('id')
      state.marks = state.marks.filter((m) => m.id !== id)
      return json({ marks: state.marks })
    }
    return json({ marks: state.marks })
  }

  if (path === '/lr-reader/api/translate') return json({ text: '（假后端）这是一段划词翻译结果，用于验证浮层排版。' })
  if (path === '/lr-reader/api/pdf2zh/config') {
    return json({ configured: true, baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-chat', keyMask: 'sk-1••••abcd' })
  }
  if (path === '/lr-reader/api/markdown' && method === 'GET') {
    return json({ job: { status: 'done', stage: '完成', percent: 100 }, ready: true })
  }
  if (path === '/lr-reader/api/markdown' && method === 'POST') {
    return json({ key: 'TESTKEY1__sample', status: 'done', stage: '完成', percent: 100, pages: 2, blocks: 11 })
  }
  if (path === '/lr-reader/api/markdown/blocks') return json(MD)
  if (path === '/lr-reader/api/zotero/translate/status') return json({ job: null, variants: [] })

  return realFetch(input, init)
}

const el = document.getElementById('root')
if (el) {
  createRoot(el).render(createElement(ReaderPane))
}

// 供自动检查读取
;(window as unknown as Record<string, unknown>).__previewState = state
