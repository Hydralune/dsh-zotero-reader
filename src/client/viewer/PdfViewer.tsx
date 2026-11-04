// PdfViewer.tsx — 自写 pdf.js 渲染内核（无 iframe、无第三方 UI）。
//
// 结构（每个页面）：
//   .zr-page-box              ← 尺寸 = viewport，负责占位与定位
//     canvas                  ← 位图，按 devicePixelRatio 放大
//     .textLayer              ← pdf.js TextLayer，透明文字，唯一可选中层
//     .zr-hit-layer           ← 搜索命中/高亮标记（P2 接管高亮）
//
// 四个关键设计：
//  1. **虚拟化**：IntersectionObserver 决定哪些页真正渲染，其余只留占位高度；
//  2. **单渲染队列**：同一页同一 scale 只渲染一次，scale 变化时整体失效重来；
//  3. **尺寸先行**：先拿到全部 viewport 尺寸再排版，滚动条不会在渲染中跳动；
//  4. **文本层用官方 TextLayer**：坐标/字体度量交给 pdf.js，选中精度直接到位。
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import { openPdf, type OpenResult } from './pdf'
import { HighlightLayer } from './HighlightLayer'
import type { ReaderLocation } from '../api'
import type { PageSelection } from './selection'
import type { NoteMark } from '../api'

export interface PdfViewerHandle {
  jumpTo(page: number, y?: number): void
  /** 滚动容器（划词时用来判断选区是否落在 PDF 内） */
  scrollElement(): HTMLElement | null
  /** 当前页可见文本（给 AI 当上下文） */
  pageText(page: number): Promise<string>
  /** 全文搜索：返回命中的页码与次数 */
  search(query: string): Promise<Array<{ page: number; count: number }>>
  /** 清掉搜索标记 */
  clearSearch(): void
  /** 在某一页闪现一个归一化矩形（文本视图点块回跳时用） */
  flashRect(page: number, bbox: [number, number, number, number]): void
}

export interface PdfCapture {
  page: number
  image: Promise<Blob>
  anchor: { x: number; y: number; bottom: number }
}

interface CapturePoint { x: number; y: number }
interface CaptureRegion { page: number; start: CapturePoint; end: CapturePoint }

export interface PdfViewerProps {
  url: string
  scale: number
  marks?: NoteMark[]
  selection?: PageSelection[]
  location?: ReaderLocation | null
  captureMode?: boolean
  onCapture?: (capture: PdfCapture | null) => void
  onJumpText?: (page: number, x: number, y: number) => void
  activeMarkId?: string | null
  onSelectMark?: (mark: NoteMark, point: { x: number; y: number }) => void
  onDoc?: (doc: PDFDocumentProxy | null, numPages: number) => void
  onPageChange?: (page: number) => void
  onError?: (error: Error) => void
}

interface PageSlot {
  width: number
  height: number
}

const GAP = 12
const RENDER_MARGIN = '900px'

export const PdfViewer = forwardRef<PdfViewerHandle, PdfViewerProps>(function PdfViewer(
  { url, scale, marks = [], selection, location, captureMode, onCapture, onJumpText, activeMarkId, onSelectMark, onDoc, onPageChange, onError },
  ref,
) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const drag = useRef<{ pointer: number; box: HTMLElement; region: CaptureRegion } | null>(null)
  const [region, setRegion] = useState<CaptureRegion | null>(null)
  const boxRefs = useRef(new Map<number, HTMLDivElement>())
  const canvasRefs = useRef(new Map<number, HTMLCanvasElement>())
  const textRefs = useRef(new Map<number, HTMLDivElement>())
  /** 已渲染标记：`${page}@${scale}` */
  const renderedRef = useRef(new Set<string>())
  /** 当前 scale（渲染是异步的：等它跑完如果 scale 又变了，要补一次，否则画布会停在旧尺寸） */
  const scaleRef = useRef(scale)
  scaleRef.current = scale
  const renderingRef = useRef(new Set<number>())
  const openRef = useRef<OpenResult | null>(null)
  // 父组件的回调常是内联箭头函数（每次渲染身份都变）。它们不能进 effect 依赖，
  // 否则加载 effect 会不断重启、把 setDoc 永远卡在被取消的那一版上——页面一片空白。
  const onDocRef = useRef(onDoc)
  const onErrorRef = useRef(onError)
  const onPageChangeRef = useRef(onPageChange)
  onDocRef.current = onDoc
  onErrorRef.current = onError
  onPageChangeRef.current = onPageChange
  const textCache = useRef(new Map<number, string>())

  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [slots, setSlots] = useState<PageSlot[]>([])
  const [visible, setVisible] = useState<Set<number>>(() => new Set([1, 2]))
  const [current, setCurrent] = useState(1)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  /** 渲染完成时发现 scale 已过期就 +1，触发一次按新 scale 的重渲染 */
  const [renderTick, setRenderTick] = useState(0)

  /* ---------------- 打开文档 + 量尺寸 ---------------- */
  useEffect(() => {
    let cancelled = false
    setBusy(true)
    setError('')
    setDoc(null)
    setSlots([])
    renderedRef.current.clear()
    renderingRef.current.clear()
    textCache.current.clear()
    boxRefs.current.clear()
    canvasRefs.current.clear()
    textRefs.current.clear()

    openPdf(url)
      .then(async ({ doc: document, pdfjs }) => {
        if (cancelled) return
        openRef.current = { doc: document, pdfjs }

        // 统一量一遍：拿到每页在 scale=1 时的原始尺寸，之后按 scale 换算
        const sizes: PageSlot[] = new Array(document.numPages)
        const queue: number[] = []
        for (let i = 1; i <= document.numPages; i += 1) queue.push(i)
        const worker = async () => {
          for (;;) {
            const n = queue.shift()
            if (n === undefined) return
            const page = await document.getPage(n)
            const vp = page.getViewport({ scale: 1 })
            sizes[n - 1] = { width: vp.width, height: vp.height }
          }
        }
        await Promise.all([worker(), worker(), worker(), worker()])
        if (cancelled) return
        // 先给尺寸（页面盒挂出来），再报 doc —— 顺序反了的话渲染 effect 会对着还没有
        // canvas 的 DOM 空跑一趟，之后再也不会重跑。
        setSlots(sizes)
        setDoc(document)
        setNumPages(document.numPages)
        onDocRef.current?.(document, document.numPages)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        const err = e instanceof Error ? e : new Error(String(e))
        setError(err.message)
        onErrorRef.current?.(err)
      })
      .finally(() => {
        if (!cancelled) setBusy(false)
      })

    return () => {
      cancelled = true
    }
  }, [url])

  /* ---------------- 渲染一页 ---------------- */
  const renderPage = useCallback(
    async (pageNo: number) => {
      const document = openRef.current?.doc
      const pdfjs = openRef.current?.pdfjs
      if (!document || !pdfjs) return
      const key = `${pageNo}@${scale}`
      if (renderedRef.current.has(key) || renderingRef.current.has(pageNo)) return
      const renderScale = scale

      const canvas = canvasRefs.current.get(pageNo)
      const textBox = textRefs.current.get(pageNo)
      if (!canvas || !textBox) return

      renderingRef.current.add(pageNo)
      try {
        const page: PDFPageProxy = await document.getPage(pageNo)
        const viewport = page.getViewport({ scale })
        const dpr = Math.min(window.devicePixelRatio || 1, 2)

        canvas.width = Math.floor(viewport.width * dpr)
        canvas.height = Math.floor(viewport.height * dpr)
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`
        const ctx = canvas.getContext('2d', { alpha: false })
        if (!ctx) throw new Error('无法创建 2D 画布')

        await page.render({
          canvas,
          canvasContext: ctx,
          viewport,
          transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
        }).promise

        // 文本层：坐标与字体度量交给 pdf.js
        textBox.replaceChildren()
        textBox.style.setProperty('--total-scale-factor', String(viewport.scale))
        const layer = new pdfjs.TextLayer({
          textContentSource: page.streamTextContent({ includeMarkedContent: true, disableNormalization: true }),
          container: textBox,
          viewport,
        })
        await layer.render()

        renderedRef.current.add(key)
      } catch (e) {
        // 单页失败不拖垮整篇：记一笔，用户仍能翻
        console.warn('[zr] render page failed', pageNo, e)
      } finally {
        renderingRef.current.delete(pageNo)
        // 渲染期间缩放变了：这一版已过期。不能自己再调一次（闭包里还是旧 scale），
        // 用 tick 触发一次带新 scale 的渲染流程。
        if (scaleRef.current !== renderScale) setRenderTick((n) => n + 1)
      }
    },
    [scale],
  )

  /* ---------------- 可见性观察（虚拟化的开关） ---------------- */
  useEffect(() => {
    const root = scrollRef.current
    if (!root || !numPages) return
    const io = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          const next = new Set(prev)
          let changed = false
          for (const entry of entries) {
            const pageNo = Number((entry.target as HTMLElement).dataset.page)
            if (!pageNo) continue
            if (entry.isIntersecting && !next.has(pageNo)) {
              next.add(pageNo)
              changed = true
            } else if (!entry.isIntersecting && next.size > 4 && next.has(pageNo)) {
              // 只回收远处页面，保证回滚不闪
              next.delete(pageNo)
              changed = true
            }
          }
          return changed ? next : prev
        })
      },
      { root, rootMargin: RENDER_MARGIN, threshold: 0 },
    )
    for (const el of boxRefs.current.values()) io.observe(el)
    return () => io.disconnect()
  }, [numPages, slots.length])

  /* ---------------- 可见 + scale 变化 → 排渲染 ---------------- */
  useEffect(() => {
    if (!doc) return
    for (const pageNo of visible) void renderPage(pageNo)
  }, [doc, visible, scale, renderPage, slots.length, renderTick])

  /* ---------------- 滚动 → 当前页 ---------------- */
  useEffect(() => {
    const root = scrollRef.current
    if (!root) return
    let raf = 0
    const measure = () => {
      raf = 0
      const rootTop = root.getBoundingClientRect().top
      let best = current
      let bestDist = Number.POSITIVE_INFINITY
      for (const [pageNo, el] of boxRefs.current) {
        const dist = Math.abs(el.getBoundingClientRect().top - rootTop - 8)
        if (dist < bestDist) {
          bestDist = dist
          best = pageNo
        }
      }
      if (best !== current) setCurrent(best)
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(measure)
    }
    root.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      root.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [current, numPages])

  useEffect(() => {
    if (numPages) onPageChangeRef.current?.(current)
  }, [current, numPages])

  /* ---------------- 对外 API ---------------- */
  const jumpTo = useCallback((page: number, y?: number) => {
    const root = scrollRef.current
    const el = boxRefs.current.get(page)
    if (!root || !el) return
    root.scrollTo({ top: el.offsetTop + (y ?? 0) * el.clientHeight - (y === undefined ? GAP : 60), behavior: y === undefined ? 'smooth' : 'instant' })
    setCurrent(page)
    setVisible((prev) => new Set(prev).add(page))
    if (y === undefined) {
      el.classList.remove('zr-flash')
      void el.offsetWidth
      el.classList.add('zr-flash')
      window.setTimeout(() => el.classList.remove('zr-flash'), 900)
    }
  }, [])

  const pageText = useCallback(
    async (pageNo: number): Promise<string> => {
      const cached = textCache.current.get(pageNo)
      if (cached !== undefined) return cached
      const document = openRef.current?.doc
      if (!document) return ''
      const page = await document.getPage(pageNo)
      const content = await page.getTextContent()
      const text = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      textCache.current.set(pageNo, text)
      return text
    },
    [],
  )

  const search = useCallback(
    async (query: string) => {
      const q = query.trim().toLowerCase()
      if (!q || !numPages) return []
      const hits: Array<{ page: number; count: number }> = []
      for (let pageNo = 1; pageNo <= numPages; pageNo += 1) {
        const text = (await pageText(pageNo)).toLowerCase()
        if (!text) continue
        let count = 0
        let from = 0
        for (;;) {
          const at = text.indexOf(q, from)
          if (at < 0) break
          count += 1
          from = at + q.length
        }
        if (count) hits.push({ page: pageNo, count })
      }
      // 立刻在已渲染页面上标出来
      markRendered(q)
      return hits
    },
    [numPages, pageText],
  )

  const markRendered = useCallback((query: string) => {
    const q = query.trim().toLowerCase()
    for (const box of textRefs.current.values()) {
      for (const span of box.querySelectorAll<HTMLElement>('span')) {
        const hit = q.length > 0 && (span.textContent ?? '').toLowerCase().includes(q)
        span.classList.toggle('zr-hit', hit)
      }
    }
  }, [])

  // 文本层是异步渲染的，渲染完再补一次标记
  useEffect(() => {
    if (!doc) return
    const timer = window.setInterval(() => markRendered(lastQuery.current), 1200)
    return () => window.clearInterval(timer)
  }, [doc, markRendered])

  const lastQuery = useRef('')

  useImperativeHandle(
    ref,
    () => ({
      jumpTo,
      scrollElement: () => scrollRef.current,
      pageText,
      search: async (query: string) => {
        lastQuery.current = query
        return search(query)
      },
      clearSearch: () => {
        lastQuery.current = ''
        markRendered('')
      },
      flashRect: (page: number, bbox: [number, number, number, number]) => {
        const box = boxRefs.current.get(page)
        if (!box) return
        const [x0, y0, x1, y1] = bbox
        const overlay = document.createElement('div')
        overlay.className = 'zr-flash-rect'
        overlay.style.left = `${x0 * 100}%`
        overlay.style.top = `${y0 * 100}%`
        overlay.style.width = `${Math.max(0.004, x1 - x0) * 100}%`
        overlay.style.height = `${Math.max(0.004, y1 - y0) * 100}%`
        box.appendChild(overlay)
        window.setTimeout(() => overlay.remove(), 1400)
      },
    }),
    [jumpTo, pageText, search, markRendered],
  )

  /* ---------------- 点是"点高亮"还是"划词" ---------------- */
  // 高亮块不吃鼠标事件（否则划不动已高亮的段落）。点击是否命中某条高亮，
  // 由这里用归一化坐标做几何判定：没有非空选区 = 单击 → 找命中的 mark。
  const clickMark = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!onSelectMark) return
      const selection = window.getSelection()
      if (selection && !selection.isCollapsed) return
      const target = event.target as HTMLElement | null
      const box = target?.closest?.('.zr-page-box') as HTMLElement | null
      if (!box) return
      const page = Number(box.dataset.page)
      if (!page) return
      const rect = box.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) return
      const nx = (event.clientX - rect.left) / rect.width
      const ny = (event.clientY - rect.top) / rect.height
      const hit = marks.find(
        (m) => m.page === page && m.rects.some((r) => nx >= r.x && nx <= r.x + r.w && ny >= r.y && ny <= r.y + r.h),
      )
      if (hit) onSelectMark(hit, { x: event.clientX, y: event.clientY })
    },
    [marks, onSelectMark],
  )

  const scaled = useMemo(
    () => slots.map((s) => ({ width: s.width * scale, height: s.height * scale })),
    [slots, scale],
  )

  useEffect(() => {
    drag.current = null
    setRegion(null)
    onCapture?.(null)
  }, [captureMode, url, scale, onCapture])

  const clearCapture = () => {
    drag.current = null
    setRegion(null)
    onCapture?.(null)
  }
  const pointAt = (event: ReactPointerEvent, box: HTMLElement): CapturePoint => {
    const rect = box.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    }
  }
  const startCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!captureMode || event.button !== 0 || !event.isPrimary || !(event.target instanceof Element)) return
    clearCapture()
    const box = event.target.closest<HTMLElement>('.zr-page-box')
    if (!box) return
    const page = Number(box.dataset.page)
    if (!renderedRef.current.has(`${page}@${scale}`)) return
    const start = pointAt(event, box)
    const next = { page, start, end: start }
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { pointer: event.pointerId, box, region: next }
    setRegion(next)
  }
  const moveCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = drag.current
    if (active?.pointer !== event.pointerId) return
    active.region = { ...active.region, end: pointAt(event, active.box) }
    setRegion(active.region)
  }
  const finishCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = drag.current
    if (active?.pointer !== event.pointerId) return
    drag.current = null
    const final = { ...active.region, end: pointAt(event, active.box) }
    const { left, top, width, height } = captureBounds(final)
    const box = active.box.getBoundingClientRect()
    const source = canvasRefs.current.get(final.page)
    if (!source || width * box.width < 5 || height * box.height < 5) {
      clearCapture()
      return
    }
    const sx = Math.floor(left * source.width)
    const sy = Math.floor(top * source.height)
    const crop = document.createElement('canvas')
    crop.width = Math.ceil((left + width) * source.width) - sx
    crop.height = Math.ceil((top + height) * source.height) - sy
    const context = crop.getContext('2d')
    if (!context) { clearCapture(); return }
    context.drawImage(source, sx, sy, crop.width, crop.height, 0, 0, crop.width, crop.height)
    const image = new Promise<Blob>((resolve, reject) =>
      crop.toBlob((blob) => blob ? resolve(blob) : reject(new Error('无法生成截图')), 'image/png'),
    )
    void image.catch(() => {})
    setRegion(final)
    onCapture?.({ page: final.page, image, anchor: {
      x: box.left + (left + width / 2) * box.width,
      y: box.top + top * box.height,
      bottom: box.top + (top + height) * box.height,
    } })
  }

  if (error) {
    return (
      <div className="zr-empty">
        <div className="zr-empty-title">打不开这份 PDF</div>
        <div style={{ fontSize: 12, maxWidth: 460 }}>{error}</div>
      </div>
    )
  }

  return (
    <div className="zr-pdf-scroll" ref={scrollRef} data-capture-mode={captureMode ? '' : undefined}
      onPointerDown={startCapture} onPointerMove={moveCapture} onPointerUp={finishCapture}
      onPointerCancel={clearCapture} onLostPointerCapture={(event) => {
        if (drag.current?.pointer === event.pointerId) clearCapture()
      }} onScroll={() => { if (captureMode && !drag.current && region) clearCapture() }}
      onClick={captureMode ? undefined : clickMark} onDoubleClick={(event) => {
      if (captureMode) return
      const target = event.target as HTMLElement
      const box = target.closest<HTMLElement>('.zr-page-box')
      if (!box || !onJumpText || !target.closest('.textLayer')) return
      event.preventDefault()
      const rect = box.getBoundingClientRect()
      onJumpText(Number(box.dataset.page), (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height)
    }}>
      {busy && !numPages ? <div className="zr-pdf-loading">载入 PDF…</div> : null}
      <div className="zr-pdf-stack">
        {scaled.map((size, i) => {
          const pageNo = i + 1
          const selectionRects = selection?.find((entry) => entry.page === pageNo)?.rects
          return (
            <div
              key={pageNo}
              data-page={pageNo}
              data-pt-w={slots[i]?.width ? +slots[i].width.toFixed(2) : undefined}
              data-pt-h={slots[i]?.height ? +slots[i].height.toFixed(2) : undefined}
              className="zr-page-box"
              style={{ width: size.width, height: size.height }}
              ref={(el) => {
                if (el) boxRefs.current.set(pageNo, el)
                else boxRefs.current.delete(pageNo)
                return undefined
              }}
            >
              {region?.page === pageNo ? (
                <div className="zr-capture-region" aria-hidden="true" style={Object.fromEntries(
                  Object.entries(captureBounds(region)).map(([key, value]) => [key, `${value * 100}%`]),
                )} />
              ) : null}
              <canvas
                className="zr-page-canvas"
                ref={(el) => {
                  if (el) canvasRefs.current.set(pageNo, el)
                  else canvasRefs.current.delete(pageNo)
                  return undefined
                }}
              />
              <div
                className="textLayer"
                ref={(el) => {
                  if (el) textRefs.current.set(pageNo, el)
                  else textRefs.current.delete(pageNo)
                  return undefined
                }}
              />
              {location?.page === pageNo && location.bbox[2] > location.bbox[0] ? (
                <div className="zr-pdf-locator" aria-hidden="true" style={{
                  left: `${location.bbox[0] * 100}%`, top: `${location.bbox[1] * 100}%`,
                  width: `${(location.bbox[2] - location.bbox[0]) * 100}%`,
                  height: `${(location.bbox[3] - location.bbox[1]) * 100}%`,
                }} />
              ) : null}
              <HighlightLayer page={pageNo} marks={marks} activeId={activeMarkId} />
              {selectionRects?.length ? (
                <svg className="zr-selection-preview" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
                  <path d={selectionRects.map(
                    ({ x, y, w, h }) => `M ${x} ${y} h ${w} v ${h} h ${-w} Z`,
                  ).join(' ')} />
                </svg>
              ) : null}
              <div className="zr-page-no">{pageNo}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
})

export default PdfViewer

function captureBounds({ start, end }: CaptureRegion) {
  return {
    left: Math.min(start.x, end.x), top: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y),
  }
}
