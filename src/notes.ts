// notes.ts — 高亮 / 下划线 / 删除线的持久化。
//
// 存储：<DSH_HOME>/.dsh-lr-reader/notes/<attachKey>__<stem>.json
//   { "version": 1, "attachKey": "...", "file": "...", "marks": [ ... ] }
//
// 坐标约定：**页面盒内的归一化矩形**（0..1），与缩放、DPR、窗口大小全部无关，
// 换机器换个缩放都能落在同一处。这是从旧实现（写死像素 + 写进 Zotero storage）改过来的核心。

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { notesDir } from './config.ts'

export type MarkKind = 'highlight' | 'underline' | 'strike'

export interface MarkRect {
  /** 相对页面左边缘，0..1 */
  x: number
  /** 相对页面上边缘，0..1 */
  y: number
  w: number
  h: number
}

export interface NoteMark {
  id: string
  kind: MarkKind
  /** #rrggbb */
  color: string
  /** 1 起的页码 */
  page: number
  rects: MarkRect[]
  /** 选中的原文（用于列表展示与导出） */
  text: string
  createdAt: string
}

export class NotesError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'NotesError'
  }
}

const ATTACH_KEY = /^[A-Z0-9]{8}$/i
const COLORS = new Set([
  '#ffeb3b',
  '#ffc107',
  '#ff9800',
  '#f44336',
  '#e91e63',
  '#9c27b0',
  '#3f51b5',
  '#2196f3',
  '#4caf50',
])

/** 校验并返回规范化的附件 key */
export function assertAttachKey(value: string): string {
  const key = (value || '').trim()
  if (!ATTACH_KEY.test(key)) throw new NotesError('bad-key', 400, '非法附件 key')
  return key.toUpperCase()
}

/** 只允许 base name，杜绝路径穿越 */
function stemOf(file: string): string {
  const base = path.basename((file || '').trim())
  if (!base || base === '.' || base === '..' || base.includes('\0')) {
    throw new NotesError('bad-file', 400, '非法文件名')
  }
  return base.replace(/\.pdf$/i, '')
}

export function notesPath(attachKey: string, file: string): string {
  return path.join(notesDir(), `${assertAttachKey(attachKey)}__${stemOf(file)}.json`)
}

interface NotesFile {
  version: 1
  attachKey: string
  file: string
  marks: NoteMark[]
}

function normalizeRect(raw: unknown): MarkRect | null {
  const r = raw as Partial<MarkRect> | null
  if (!r || typeof r !== 'object') return null
  const x = Number(r.x)
  const y = Number(r.y)
  const w = Number(r.w)
  const h = Number(r.h)
  if (![x, y, w, h].every((n) => Number.isFinite(n))) return null
  // 夹到页面内，并丢掉零面积
  const cx = Math.min(Math.max(x, 0), 1)
  const cy = Math.min(Math.max(y, 0), 1)
  const cw = Math.min(Math.max(w, 0), 1 - cx)
  const ch = Math.min(Math.max(h, 0), 1 - cy)
  if (cw <= 0.0005 || ch <= 0.0005) return null
  return { x: +cx.toFixed(5), y: +cy.toFixed(5), w: +cw.toFixed(5), h: +ch.toFixed(5) }
}

function normalizeMark(raw: unknown): NoteMark | null {
  const m = raw as Partial<NoteMark> | null
  if (!m || typeof m !== 'object') return null
  const kind: MarkKind =
    m.kind === 'underline' || m.kind === 'strike' || m.kind === 'highlight' ? m.kind : 'highlight'
  const page = Math.trunc(Number(m.page))
  if (!Number.isFinite(page) || page < 1) return null
  const rects = Array.isArray(m.rects)
    ? (m.rects.map(normalizeRect).filter(Boolean) as MarkRect[])
    : []
  if (!rects.length) return null
  const color = typeof m.color === 'string' && /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : '#ffeb3b'
  return {
    id: typeof m.id === 'string' && m.id.length <= 64 ? m.id : randomUUID(),
    kind,
    color: COLORS.has(color.toLowerCase()) ? color.toLowerCase() : color,
    page,
    rects,
    text: typeof m.text === 'string' ? m.text.slice(0, 4000) : '',
    createdAt: typeof m.createdAt === 'string' ? m.createdAt : new Date().toISOString(),
  }
}

export async function readMarks(attachKey: string, file: string): Promise<NoteMark[]> {
  const target = notesPath(attachKey, file)
  try {
    const raw = JSON.parse(await fs.readFile(target, 'utf8')) as Partial<NotesFile>
    if (!Array.isArray(raw.marks)) return []
    return raw.marks.map(normalizeMark).filter(Boolean) as NoteMark[]
  } catch {
    return []
  }
}

async function writeAll(attachKey: string, file: string, marks: NoteMark[]): Promise<void> {
  const target = notesPath(attachKey, file)
  await fs.mkdir(path.dirname(target), { recursive: true })
  const body: NotesFile = {
    version: 1,
    attachKey: assertAttachKey(attachKey),
    file: path.basename(file),
    marks,
  }
  const tmp = `${target}.tmp-${process.pid}`
  await fs.writeFile(tmp, JSON.stringify(body, null, 2), 'utf8')
  await fs.rename(tmp, target)
}

/** 追加一批标记（一次划词可能跨页，产生多条），返回合并后的全量 */
export async function addMarks(attachKey: string, file: string, incoming: unknown[]): Promise<NoteMark[]> {
  const existing = await readMarks(attachKey, file)
  const fresh = incoming.map(normalizeMark).filter(Boolean) as NoteMark[]
  const merged = [...existing, ...fresh]
  await writeAll(attachKey, file, merged)
  return merged
}

export async function removeMark(attachKey: string, file: string, id: string): Promise<NoteMark[]> {
  const existing = await readMarks(attachKey, file)
  const next = existing.filter((m) => m.id !== id)
  await writeAll(attachKey, file, next)
  return next
}

/** 改一条标记的颜色/形态（高亮↔下划线↔删除线） */
export async function updateMark(
  attachKey: string,
  file: string,
  id: string,
  patch: { color?: string; kind?: MarkKind },
): Promise<NoteMark[]> {
  const existing = await readMarks(attachKey, file)
  const index = existing.findIndex((m) => m.id === id)
  if (index < 0) throw new NotesError('not-found', 404, '找不到这条标记')
  const current = existing[index]
  const color =
    typeof patch.color === 'string' && /^#[0-9a-f]{6}$/i.test(patch.color) ? patch.color.toLowerCase() : current.color
  const kind: MarkKind =
    patch.kind === 'highlight' || patch.kind === 'underline' || patch.kind === 'strike' ? patch.kind : current.kind
  const next = [...existing]
  next[index] = { ...current, color, kind }
  await writeAll(attachKey, file, next)
  return next
}

/** 导出为 Markdown（按页分组，带原文引文） */
export function toMarkdown(title: string, marks: NoteMark[]): string {
  const byPage = new Map<number, NoteMark[]>()
  for (const mark of marks) {
    const bucket = byPage.get(mark.page)
    if (bucket) bucket.push(mark)
    else byPage.set(mark.page, [mark])
  }
  const lines = [`# ${title || '阅读笔记'}`, '']
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    lines.push(`## p.${page}`, '')
    for (const mark of byPage.get(page) ?? []) {
      const label = mark.kind === 'underline' ? '下划线' : mark.kind === 'strike' ? '删除线' : '高亮'
      lines.push(`> ${mark.text.replace(/\n+/g, ' ')}`, '', `— ${label} · ${mark.color}`, '')
    }
  }
  return lines.join('\n')
}
