// api.ts — 浏览器侧对插件路由的唯一入口（全部在 /lr-reader 前缀下）。
// 任何 http 细节（错误体、SSE 分帧）都收敛在这里，组件只拿数据。

const BASE = '/lr-reader'

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
  const text = await res.text()
  let data: unknown
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { error: text.slice(0, 400) }
  }
  if (!res.ok) {
    const body = data as { error?: string; code?: string }
    throw new ApiError(body.error || `HTTP ${res.status}`, res.status, body.code)
  }
  return data as T
}

export const post = <T>(path: string, body: unknown): Promise<T> =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) })

/* ------------------------------------------------------------------ */
/* 类型                                                                */
/* ------------------------------------------------------------------ */

export interface Creator {
  firstName?: string
  lastName?: string
}

export interface ZoteroPaper {
  itemID: number
  key: string
  title: string
  creators: Creator[]
  year?: string
  doi?: string
  venue?: string
  collections: string[]
  collectionIDs?: number[]
  /** 附件 key（storage/<attachKey>/） */
  attachKey: string
  /** 附件文件名 */
  file: string
  /** 同目录下已存在的译文变体：<stem>-zh.pdf / -dual.pdf */
  variants: string[]
}

export interface ZoteroCollection {
  collectionID: number
  name: string
  parentID: number | null
  itemCount: number
}

export interface ZoteroLibrary {
  zoteroDir: string
  collections: ZoteroCollection[]
  papers: ZoteroPaper[]
  total: number
}

export type MarkKind = 'highlight' | 'underline' | 'strike'

/** 页面盒内的归一化矩形（0..1） */
export interface MarkRect {
  x: number
  y: number
  w: number
  h: number
}

export interface NoteMark {
  id: string
  kind: MarkKind
  color: string
  page: number
  rects: MarkRect[]
  text: string
  createdAt: string
}

export interface LlmRoute {
  provider: string
  model: string
  reasoningEffort?: string
}

export interface TranslateJob {
  key: string
  status: 'running' | 'done' | 'error'
  stage: string
  percent: number
  error?: string
  startedAt: number
  finishedAt?: number
  mono?: string
  dual?: string
}

/* ------------------------------------------------------------------ */
/* Zotero                                                              */
/* ------------------------------------------------------------------ */

export const getZoteroLibrary = () => api<ZoteroLibrary>('/api/zotero/library')

/** PDF 的直读 URL（host 侧支持 Range） */
export function pdfUrl(paper: Pick<ZoteroPaper, 'attachKey' | 'file'>, variant?: string): string {
  const file = variant || paper.file
  return (
    `${BASE}/api/zotero/file?key=${encodeURIComponent(paper.attachKey)}` +
    `&file=${encodeURIComponent(file)}`
  )
}

/* ------------------------------------------------------------------ */
/* 笔记                                                                */
/* ------------------------------------------------------------------ */

const noteQs = (paper: Pick<ZoteroPaper, 'attachKey' | 'file'>, extra = '') =>
  `/api/notes?key=${encodeURIComponent(paper.attachKey)}&file=${encodeURIComponent(paper.file)}${extra}`

export const getNotes = (paper: ZoteroPaper) => api<{ marks: NoteMark[] }>(noteQs(paper))

export const addNotes = (paper: ZoteroPaper, marks: NoteMark[]) =>
  post<{ marks: NoteMark[] }>(noteQs(paper), { marks })

export const deleteNote = (paper: ZoteroPaper, id: string) =>
  api<{ marks: NoteMark[] }>(noteQs(paper, `&id=${encodeURIComponent(id)}`), { method: 'DELETE' })

export const updateNote = (paper: ZoteroPaper, id: string, patch: { color?: string; kind?: MarkKind }) =>
  api<{ marks: NoteMark[] }>(noteQs(paper), { method: 'PATCH', body: JSON.stringify({ id, ...patch }) })

export const notesExportUrl = (paper: ZoteroPaper) =>
  `${BASE}/api/notes/export?key=${encodeURIComponent(paper.attachKey)}` +
  `&file=${encodeURIComponent(paper.file)}&title=${encodeURIComponent(paper.title)}`

/* ------------------------------------------------------------------ */
/* AI（走 DSH 自己的 llm 服务）                                         */
/* ------------------------------------------------------------------ */

export const getRoute = () => api<{ route: LlmRoute | null }>('/api/route')

export const translateText = (text: string, to: 'zh' | 'en' = 'zh') =>
  post<{ text: string }>('/api/translate', { text, to }).then((r) => r.text)

export interface ChatBody {
  turns: Array<{ role: 'user' | 'assistant'; text: string }>
  selection?: string
  question?: string
  page?: number
  paperTitle?: string
  context?: string
}

export interface ChatHandlers {
  onRoute?: (route: LlmRoute) => void
  onDelta: (text: string) => void
  onError?: (error: Error) => void
  onDone?: () => void
}

/** POST /api/chat 的 SSE 消费器；返回 abort 函数 */
export function streamChat(body: ChatBody, handlers: ChatHandlers, signal?: AbortSignal): () => void {
  const ac = new AbortController()
  const abort = () => ac.abort()
  if (signal) {
    if (signal.aborted) ac.abort()
    else signal.addEventListener('abort', abort, { once: true })
  }

  void (async () => {
    try {
      const res = await fetch(BASE + '/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: ac.signal,
      })
      if (!res.ok || !res.body) {
        const raw = await res.text().catch(() => '')
        throw new ApiError(raw.slice(0, 300) || `HTTP ${res.status}`, res.status)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let cut: number
        while ((cut = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, cut)
          buffer = buffer.slice(cut + 2)
          let event = 'message'
          let data = ''
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim()
            else if (line.startsWith('data:')) data += line.slice(5).trim()
          }
          if (!data) continue
          let parsed: unknown
          try {
            parsed = JSON.parse(data)
          } catch {
            continue
          }
          if (event === 'delta') handlers.onDelta(String((parsed as { text?: string }).text ?? ''))
          else if (event === 'route') handlers.onRoute?.(parsed as LlmRoute)
          else if (event === 'error')
            handlers.onError?.(new Error(String((parsed as { message?: string }).message ?? '模型错误')))
          else if (event === 'done') handlers.onDone?.()
        }
      }
      handlers.onDone?.()
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      handlers.onError?.(e as Error)
    }
  })()

  return abort
}

/* ------------------------------------------------------------------ */
/* 整篇翻译（pdf2zh）                                                   */
/* ------------------------------------------------------------------ */

export interface Pdf2zhConfig {
  configured: boolean
  baseURL: string
  model: string
  keyMask: string
}

export const getPdf2zhConfig = () => api<Pdf2zhConfig>('/api/pdf2zh/config')
export const savePdf2zhConfig = (body: { baseURL: string; apiKey?: string; model: string }) =>
  post<{ ok: true }>('/api/pdf2zh/config', body)

export const getTranslateStatus = (paper: ZoteroPaper) =>
  api<{ job: TranslateJob | null; variants: string[] }>(
    `/api/zotero/translate/status?key=${encodeURIComponent(paper.attachKey)}` +
      `&file=${encodeURIComponent(paper.file)}`,
  )

export const startTranslate = (paper: ZoteroPaper) =>
  post<TranslateJob>('/api/zotero/translate', { attachKey: paper.attachKey, file: paper.file })

/* ------------------------------------------------------------------ */
/* 文本视图（PDF → Markdown + 块索引）                                  */
/* ------------------------------------------------------------------ */

export interface ReaderLocation {
  page: number
  bbox: [number, number, number, number]
}

export interface MdBlock {
  id: string
  type: 'title' | 'text' | 'list' | 'table' | 'figure' | 'caption' | 'equation'
  level?: number
  /** 归一化 bbox：[x0, y0, x1, y1] */
  bbox: [number, number, number, number]
  text: string
  markdown?: string
  crop?: boolean
  role?: 'document-title' | 'byline' | 'reference'
}

export interface MdPage {
  page: number
  width: number
  height: number
  blocks: MdBlock[]
  source?: 'pymupdf' | 'mineru'
  parser?: MdDocument['parser']
}

export interface MdDocument {
  source?: 'mineru'
  parser?: { version: string; tier: ReaderTier }
  version: number
  title: string
  pageCount: number
  pages: MdPage[]
  outline?: Array<{ title: string; level: number; page: number; blockId?: string | null }>
}

export interface MdJob {
  key: string
  status: 'running' | 'done' | 'error' | 'cancelled'
  stage: string
  percent: number
  error?: string
  pages?: number
  blocks?: number
}

const mdQs = (paper: ZoteroPaper) =>
  `key=${encodeURIComponent(paper.attachKey)}&file=${encodeURIComponent(paper.file)}`

export const getMarkdownStatus = (paper: ZoteroPaper) =>
  api<{ job: MdJob | null; ready: boolean }>(`/api/markdown?${mdQs(paper)}`)

export const startMarkdown = (paper: ZoteroPaper) =>
  post<MdJob>('/api/markdown', { attachKey: paper.attachKey, file: paper.file, title: paper.title })

export const getMarkdownBlocks = (paper: ZoteroPaper, source?: 'native') =>
  api<MdDocument>(`/api/markdown/blocks?${mdQs(paper)}${source ? '&source=native' : ''}`)

export const markdownFileUrl = (paper: ZoteroPaper) => `${BASE}/api/markdown/file?${mdQs(paper)}`

export const translateMarkdownPage = (paper: ZoteroPaper, page: number, signal: AbortSignal, prefetch = false) =>
  api<Record<string, string>>(`/api/markdown/translate?${mdQs(paper)}`, {
    method: 'POST', body: JSON.stringify({ page, prefetch }), signal,
  })

export const importMineruBlocks = (paper: ZoteroPaper, content: unknown) =>
  post<MdDocument>(`/api/markdown/mineru?${mdQs(paper)}`, content)

export function importZoteroPdf(file: File, collection?: number) {
  const query = new URLSearchParams({ name: file.name })
  if (collection !== undefined) query.set('collection', String(collection))
  return api<{ attachKey?: string; warning?: string }>(`/api/zotero/import?${query}`, {
    method: 'POST', headers: { 'content-type': 'application/pdf' }, body: file,
  })
}

export type ReaderTier = 'flash' | 'basic' | 'standard' | 'advanced'
export interface ReaderSetup {
  completed?: boolean
  translation?: 'dsh' | 'endpoint'
  mineruTier?: ReaderTier
  zoteroDir: string
  endpointPath: string
  endpoint: { baseURL: string; model: string; hasKey: boolean } | null
  guide: string
}
export const claimReaderWelcome = () => post<{ show: boolean }>('/api/setup/welcome', {})
export const getReaderSetup = () => api<ReaderSetup>('/api/setup')
export const checkReaderSetup = () => api<{ zotero: boolean; pymupdf: boolean; mineru: string | null; pdf2zh: boolean }>('/api/setup/check')
export const saveReaderSetup = (settings: {
  translation?: 'dsh' | 'endpoint'
  mineruTier: ReaderTier
  endpoint?: { baseURL: string; model: string; apiKey: string }
}) => post<{ ok: true }>('/api/setup', settings)
export const startMineruParse = (paper: ZoteroPaper, page?: number) => post<MdJob>(`/api/markdown/mineru/parse?${mdQs(paper)}`, { page })
export const cancelMineruParse = (paper: ZoteroPaper) => post('/api/markdown/mineru/cancel?' + mdQs(paper), {})

export interface TextAnchor {
  block: string
  side: 'original' | 'translation'
  start: number
  end: number
  quote: string
}
export interface TextMark {
  id: string
  kind: MarkKind
  color: string
  page: number
  text: string
  anchors: TextAnchor[]
  createdAt: string
}
export const getTextMarks = (paper: ZoteroPaper) => api<{ marks: TextMark[] }>(`/api/text-notes?${mdQs(paper)}`)
export const addTextMark = (paper: ZoteroPaper, mark: TextMark) => post<{ marks: TextMark[] }>(`/api/text-notes?${mdQs(paper)}`, { mark })
export const patchTextMark = (paper: ZoteroPaper, id: string, patch: { kind?: MarkKind; color?: string }) =>
  api<{ marks: TextMark[] }>(`/api/text-notes?${mdQs(paper)}`, { method: 'PATCH', body: JSON.stringify({ id, patch }) })
export const removeTextMark = (paper: ZoteroPaper, id: string) =>
  api<{ marks: TextMark[] }>(`/api/text-notes?${mdQs(paper)}&id=${encodeURIComponent(id)}`, { method: 'DELETE' })
