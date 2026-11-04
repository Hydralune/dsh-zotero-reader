// Convert selected PDF text fragments to page-relative annotation geometry.
import type { MarkRect } from '../api'

export interface PageSelection {
  page: number
  rects: MarkRect[]
}

interface PageBox {
  el: HTMLElement
  page: number
  /** 坐标基准：canvas 的 rect，缺失时退回页面盒 */
  basis: DOMRect
  ptW: number
  ptH: number
}

type Rect = { x: number; y: number; w: number; h: number }

/** LightRead 用 layoutData[pageIndex].page_size 做原点尺寸；这里读渲染时写下的 data-pt-w/h */
function readPt(el: HTMLElement): { ptW: number; ptH: number } {
  return { ptW: Number(el.dataset.ptW || 0), ptH: Number(el.dataset.ptH || 0) }
}

function pageBoxes(root: HTMLElement): PageBox[] {
  const out: PageBox[] = []
  for (const el of root.querySelectorAll<HTMLElement>('.zr-page-box[data-page]')) {
    const rect = el.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) continue
    const canvas = el.querySelector('canvas')
    const basis = canvas ? canvas.getBoundingClientRect() : rect
    const { ptW, ptH } = readPt(el)
    out.push({ el, page: Number(el.dataset.page), basis, ptW, ptH })
  }
  return out
}

/* ------------------------------------------------------------------ */
/* 行间中线 —— 高亮带的硬边界                                          */
/* ------------------------------------------------------------------ */

/** 同一行的判定容差（pt）：行距一般 ≥10pt，5pt 不会跨行误并 */
const LINE_TOL = 5

interface Row {
  top: number
  bottom: number
}

/**
 * 一页上**所有**文字行的上下沿（pt）。这不是选区，是版面 —— 用来算行间中线。
 * 取的是文字层每个 span 的盒：pdf.js 的行盒比字高略大，相邻行会有轻微交叠，
 * 正好可以用"两行盒的中间"当中线。
 */
function pageRows(box: PageBox): Row[] {
  const spans = box.el.querySelectorAll<HTMLElement>('.textLayer span')
  if (!spans.length) return []
  const scaleX = box.basis.width / box.ptW
  const scaleY = box.basis.height / box.ptH
  if (!scaleX || !scaleY) return []

  const raw: Row[] = []
  for (const span of spans) {
    const r = span.getBoundingClientRect()
    if (r.width < 0.5 || r.height < 0.5) continue
    raw.push({ top: (r.top - box.basis.top) / scaleY, bottom: (r.bottom - box.basis.top) / scaleY })
  }
  if (!raw.length) return []
  raw.sort((a, b) => a.top - b.top)

  // 按中心聚行（同一行的 span 中心几乎相同）
  const rows: Row[] = []
  for (const r of raw) {
    const center = (r.top + r.bottom) / 2
    const last = rows[rows.length - 1]
    if (last && Math.abs(center - (last.top + last.bottom) / 2) <= LINE_TOL) {
      last.top = Math.min(last.top, r.top)
      last.bottom = Math.max(last.bottom, r.bottom)
    } else {
      rows.push({ ...r })
    }
  }
  return rows
}

/**
 * 行间中线：第 k 行的高亮带只能落在 `bounds[k] .. bounds[k+1]` 之间。
 *
 *   bounds[0]      = 第一行上沿        （上方没字 → 用最高那条线）
 *   bounds[k]      = 第 k-1 行下沿与第 k 行上沿的中点
 *   bounds[n]      = 最后一行下沿      （下方没字 → 用最低那条线）
 *
 * 相邻两行共用同一条中线，所以两条带只会**相接**，不会叠。
 */
function rowBounds(rows: Row[]): number[] {
  if (!rows.length) return []
  const bounds: number[] = [rows[0].top]
  for (let i = 1; i < rows.length; i += 1) {
    bounds.push((rows[i - 1].bottom + rows[i].top) / 2)
  }
  bounds.push(rows[rows.length - 1].bottom)
  return bounds
}

/**
 * 把一条矩形夹进它所在行的上下中线之间。
 * 高度明显超过一行（比如首字下沉的「W」）就原样返回 —— 那是跨行的块，夹了会缺一块。
 */
function clipToRowBand(rect: Rect, rows: Row[], bounds: number[], medianH: number): Rect {
  if (rows.length < 2 || !bounds.length) return rect
  if (medianH > 0 && rect.h > medianH * 1.8) return rect

  const center = rect.y + rect.h / 2
  let k = -1
  for (let i = 0; i < rows.length; i += 1) {
    if (center >= bounds[i] && center <= bounds[i + 1]) {
      k = i
      break
    }
  }
  if (k < 0) return rect

  // 先夹进"这一行自己的盒"（文字层盒已经比字大一圈），再夹中线。
  // 两道都做，带子才既不出行、也不越中线 —— 行与行之间必然留出空隙。
  const top = Math.max(rect.y, rows[k].top, bounds[k])
  const bottom = Math.min(rect.y + rect.h, rows[k].bottom, bounds[k + 1])
  if (bottom - top < 0.5) return rect
  return { x: rect.x, y: top, w: rect.w, h: bottom - top }
}

/* ------------------------------------------------------------------ */
/* mergeOverlappingRects —— 原样移植                                     */
/* ------------------------------------------------------------------ */

/**
 * 合并重叠/相邻的矩形（LightRead mergeOverlappingRects）。
 * 容差单位是 **PDF pt**，与缩放无关。
 */
export function mergeLineRects(rects: Rect[], options: { dedupeTol?: number; lineTol?: number; gapTol?: number } = {}): Rect[] {
  const dedupeTol = options.dedupeTol ?? 2 // PDF 坐标容差
  const lineTol = options.lineTol ?? 5 // 5pt 内认为同一行
  const gapTol = options.gapTol ?? 3 // 3pt 内的水平间隙视为相邻
  if (rects.length <= 1) return rects

  // ① 去重：坐标几乎相同的只留一份
  const deduped: Rect[] = []
  for (const r of rects) {
    const duplicate = deduped.some(
      (u) =>
        Math.abs(u.x - r.x) < dedupeTol &&
        Math.abs(u.y - r.y) < dedupeTol &&
        Math.abs(u.w - r.w) < dedupeTol &&
        Math.abs(u.h - r.h) < dedupeTol,
    )
    if (!duplicate) deduped.push(r)
  }
  if (deduped.length <= 1) return deduped

  // ② 按行中心聚类
  const rows: Array<{ centerY: number; rects: Rect[] }> = []
  for (const r of deduped) {
    const centerY = r.y + r.h / 2
    let row = rows.find((row) => Math.abs(row.centerY - centerY) <= lineTol)
    if (!row) {
      row = { centerY, rects: [] }
      rows.push(row)
    }
    row.rects.push(r)
    // 行中心取平均，避免长行被首段带偏
    row.centerY = row.rects.reduce((sum, rect) => sum + rect.y + rect.h / 2, 0) / row.rects.length
  }

  // ③ 行内按 x 排序后合并相邻/重叠段
  const result: Rect[] = []
  for (const row of rows) {
    const sorted = [...row.rects].sort((a, b) => a.x - b.x)
    let current = { ...sorted[0] }
    for (let i = 1; i < sorted.length; i += 1) {
      const next = sorted[i]
      const currentRight = current.x + current.w
      if (next.x <= currentRight + gapTol) {
        const newRight = Math.max(currentRight, next.x + next.w)
        const newTop = Math.min(current.y, next.y)
        const newBottom = Math.max(current.y + current.h, next.y + next.h)
        current = { x: current.x, y: newTop, w: newRight - current.x, h: newBottom - newTop }
      } else {
        result.push(current)
        current = { ...next }
      }
    }
    result.push(current)
  }
  return result
}

/**
 * 相邻行竖向重叠时按中线均分。
 * LightRead 原版没有这一步 —— 它靠 span 的 line-height:1 让行盒恰好等于行距。
 * 这里保留为**兜底**：只有真的量到重叠（>0.5pt）才收，正常情况不会改动任何矩形。
 */
export function trimVerticalOverlaps(rects: Rect[]): Rect[] {
  if (rects.length <= 1) return rects
  const sorted = [...rects].sort((a, b) => a.y - b.y).map((r) => ({ ...r }))
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const upper = sorted[i]
    const lower = sorted[i + 1]
    const overlap = upper.y + upper.h - lower.y
    if (overlap <= 0.5) continue
    const half = overlap / 2
    upper.h = +Math.max(upper.h * 0.5, upper.h - half).toFixed(4)
    const lowerLose = Math.min(lower.h * 0.5, half)
    lower.y = +(lower.y + lowerLose).toFixed(4)
    lower.h = +Math.max(lower.h * 0.5, lower.h - lowerLose).toFixed(4)
  }
  return sorted
}

/* ------------------------------------------------------------------ */
/* rangeToPdfRects —— 原样移植                                          */
/* ------------------------------------------------------------------ */

/** Measure only the selected character runs. A range across elements also reports
 * element boxes, including PDF.js line breaks and other layout-only nodes. */
function textRects(range: Range, layer: HTMLElement): DOMRect[] {
  const result: DOMRect[] = []
  const walker = layer.ownerDocument.createTreeWalker(layer, NodeFilter.SHOW_TEXT)
  const fragment = layer.ownerDocument.createRange()
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.parentElement?.closest('span') || !range.intersectsNode(node)) continue
    const start = node === range.startContainer ? range.startOffset : 0
    const end = node === range.endContainer ? range.endOffset : node.textContent!.length
    if (!node.textContent!.slice(start, end).trim()) continue
    fragment.setStart(node, start)
    fragment.setEnd(node, end)
    for (const rect of fragment.getClientRects()) {
      if (rect.width > 0 && rect.height > 0) result.push(rect)
    }
  }
  return result
}

function selectionToPageRects(range: Range, boxes: PageBox[]) {
  const fragments: DOMRect[] = []
  const byPage = new Map<number, Rect[]>()
  for (const box of boxes) {
    const layer = box.el.querySelector<HTMLElement>('.textLayer')
    if (!layer || !range.intersectsNode(layer) || !box.ptW || !box.ptH) continue
    for (const fragment of textRects(range, layer)) {
      const left = Math.max(fragment.left, box.basis.left)
      const top = Math.max(fragment.top, box.basis.top)
      const right = Math.min(fragment.right, box.basis.right)
      const bottom = Math.min(fragment.bottom, box.basis.bottom)
      if (right <= left || bottom <= top) continue
      const r = new DOMRect(left, top, right - left, bottom - top)
      fragments.push(r)
      const scaleX = box.basis.width / box.ptW
      const scaleY = box.basis.height / box.ptH
      const list = byPage.get(box.page) ?? []
      list.push({
        x: (r.left - box.basis.left) / scaleX,
        y: (r.top - box.basis.top) / scaleY,
        w: r.width / scaleX,
        h: r.height / scaleY,
      })
      byPage.set(box.page, list)
    }
  }

  // ③ 每页合并成「每行一条」，再夹到行间中线里
  const out: Array<{ page: number; rects: Rect[] }> = []
  for (const [page, rects] of byPage) {
    const box = boxes.find((b) => b.page === page)
    const merged = mergeLineRects(rects)
    const rows = box ? pageRows(box) : []
    const bounds = rowBounds(rows)
    const heights = rows.map((r) => r.bottom - r.top).sort((a, b) => a - b)
    const medianH = heights.length ? heights[Math.floor(heights.length / 2)] : 0
    const clipped = merged
      .map((r) => clipToRowBand(r, rows, bounds, medianH))
      .filter((r) => r.w > 0 && r.h > 0)
    if (clipped.length) out.push({ page, rects: clipped })
  }
  return { pages: out.sort((a, b) => a.page - b.page), fragments }
}

/* ------------------------------------------------------------------ */
/* pickAnchorRect —— 原样移植（PdfShow.pickAnchorRect）                  */
/* ------------------------------------------------------------------ */

/**
 * 选区的锚点矩形：多 rect 时优先取**离 mouseup 最近**的那个，避免锚点乱跳；
 * 没有鼠标位置（键盘选）时取最后一个 rect。
 */
function pickAnchorRect(rects: DOMRect[], pointer: { x: number; y: number } | null): DOMRect | null {
  if (!rects.length) return null

  if (pointer) {
    let best = rects[0]
    let bestDist = Number.POSITIVE_INFINITY
    for (const r of rects) {
      const cx = (r.left + r.right) / 2
      const cy = (r.top + r.bottom) / 2
      const d = (cx - pointer.x) ** 2 + (cy - pointer.y) ** 2
      if (d < bestDist) {
        bestDist = d
        best = r
      }
    }
    return best
  }
  return rects[rects.length - 1] ?? null
}

/* ------------------------------------------------------------------ */
/* 选中快照                                                            */
/* ------------------------------------------------------------------ */

export interface SelectionSnapshot {
  text: string
  /** 归一化后的矩形（存盘 / 渲染用） */
  pages: PageSelection[]
  /**
   * 工具条定位点（**视口坐标**，工具条是 position: fixed）：
   *  - x：锚点矩形水平中心（LightRead: left + width/2）
   *  - y：锚点矩形上沿
   *  - bottom：锚点矩形下沿（LightRead 把工具条放在 bottom + 8）
   */
  anchor: { x: number; y: number; bottom: number }
}

/** 读取当前选区；空白或不在 PDF 文字层内时返回 null */
export function readSelection(root: HTMLElement | null, pointer: { x: number; y: number } | null = null): SelectionSnapshot | null {
  if (!root) return null
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
  const range = selection.getRangeAt(0)

  // LightRead: 只要求选区**起点**落在 PDF 文字层里（鼠标在边缘松开也算）
  const startNode = range.startContainer
  const startEl = (startNode.nodeType === 1 ? (startNode as Element) : startNode.parentElement) ?? null
  const textLayer = startEl?.closest?.('.textLayer')
  if (!textLayer || !root.contains(textLayer)) return null

  const text = (selection.toString() || '').replace(/\s+/g, ' ').trim()
  if (!text) return null

  const boxes = pageBoxes(root)
  const { pages: raw, fragments } = selectionToPageRects(range, boxes)
  const hit = pickAnchorRect(fragments, pointer)
  if (!hit) return null

  const anchor = {
    x: hit.left + hit.width / 2,
    y: hit.top,
    bottom: hit.bottom,
  }
  if (!raw.length) return null

  // pt → 归一化（0..1）
  const pages: PageSelection[] = []
  for (const entry of raw) {
    const box = boxes.find((b) => b.page === entry.page)
    if (!box?.ptW || !box?.ptH) continue
    pages.push({
      page: entry.page,
      rects: entry.rects.map((r) => ({
        x: r.x / box.ptW,
        y: r.y / box.ptH,
        w: r.w / box.ptW,
        h: r.h / box.ptH,
      })),
    })
  }
  if (!pages.length) return null

  return { text, pages, anchor }
}

/** 清掉浏览器选区（避免点击工具条后又被读一次） */
export function clearSelection(): void {
  window.getSelection()?.removeAllRanges()
}
