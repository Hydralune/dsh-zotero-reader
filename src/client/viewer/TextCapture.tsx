import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react'
import html2canvas from 'html2canvas'
import type { ZoteroPaper } from '../api'
import { paperSource, explainInDsh, previewDshCapture, previewDshQuote, sendCaptureToDsh } from '../dshComposer'
import { Icon } from '../components/Icon'
import { CaptureToolbar } from './CaptureToolbar'
import { visibleSelectionAnchor } from './selection-anchor'
import { textCaptureContext } from './quote-context'
import type { QuoteParts } from '../dshComposer'

type Point = { x: number; y: number }
type Region = { start: Point; end: Point }
const bounds = ({ start, end }: Region) => ({ left: Math.min(start.x, end.x), top: Math.min(start.y, end.y),
  width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) })

export async function captureTextRegion(root: HTMLElement, region: ReturnType<typeof bounds>): Promise<Blob> {
  const rect = root.getBoundingClientRect()
  const scrollX = root.scrollLeft, scrollY = root.scrollTop
  const ancestors = new Set<Element>()
  for (let element: Element | null = root; element; element = element.parentElement) ancestors.add(element)
  // html2canvas normally clones the entire chat and every paper page, even for a tiny crop.
  // Keep offscreen pages/blocks as empty, measured shells so scroll positions and wrapping stay exact.
  const shells = new Set<Element>()
  const placeholders: Array<{ page: string; id: string; width: number; height: number }> = []
  const selection = { left: rect.left + region.left, top: rect.top + region.top,
    right: rect.left + region.left + region.width, bottom: rect.top + region.top + region.height }
  const outside = (element: HTMLElement) => {
    const box = element.getBoundingClientRect()
    if (box.bottom > selection.top && box.top < selection.bottom && box.right > selection.left && box.left < selection.right) return false
    shells.add(element)
    placeholders.push({ page: element.dataset.textPage ?? '', id: element.id, width: box.width, height: box.height })
    return true
  }
  for (const page of root.querySelectorAll<HTMLElement>('[data-text-page]')) {
    if (!outside(page)) page.querySelectorAll<HTMLElement>('.zr-txt-pair[id]').forEach(outside)
  }
  const scale = Math.min(2, window.devicePixelRatio || 1)
  const canvas = await html2canvas(root, {
    logging: false, backgroundColor: '#ffffff', scale,
    x: region.left, y: region.top, width: region.width, height: region.height,
    ignoreElements: element => element.hasAttribute('data-html2canvas-ignore') ||
      shells.has(element.parentElement!) ||
      (!ancestors.has(element) && !root.contains(element) && element !== document.head && !document.head.contains(element)),
    onclone: (document, clone) => {
      // Omitting unrelated UI must not change the reader's width or position in the clone.
      Object.assign(clone.style, { position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`,
        width: `${rect.width}px`, height: `${rect.height}px`, boxSizing: 'border-box', margin: '0' })
      for (const item of placeholders) {
        const shell = item.page ? clone.querySelector<HTMLElement>(`[data-text-page="${item.page}"]`) : document.getElementById(item.id)
        if (shell) Object.assign(shell.style, { width: `${item.width}px`, height: `${item.height}px`,
          minHeight: `${item.height}px`, boxSizing: 'border-box', visibility: 'hidden' })
      }
      clone.scrollLeft = scrollX; clone.scrollTop = scrollY
    },
  })
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('截图生成失败')), 'image/png'))
}

export function TextCapture({ root, paper, onNotify }: {
  root: RefObject<HTMLDivElement | null>; paper: ZoteroPaper; onNotify: (message: string) => void
}) {
  const [geometry, setGeometry] = useState<{ viewport: DOMRect; x: number; y: number } | null>(null)
  const [region, setRegion] = useState<Region | null>(null)
  const [image, setImage] = useState<{ blob: Promise<Blob>; page: number; context: Pick<QuoteParts, 'locations' | 'context' | 'text'> } | null>(null)
  const [busy, setBusy] = useState(false)
  const overlay = useRef<HTMLDivElement | null>(null)
  const drag = useRef<{ id: number; start: Point } | null>(null)
  const dragFrame = useRef(0)
  const pendingRegion = useRef<Region | null>(null)
  const stopDragFrame = () => { cancelAnimationFrame(dragFrame.current); dragFrame.current = 0; pendingRegion.current = null }
  const clear = () => { stopDragFrame(); drag.current = null; setRegion(null); setImage(null) }
  useEffect(() => () => stopDragFrame(), [])
  useEffect(() => {
    if (image) previewDshCapture({ source: paperSource(paper), title: paper.title, page: image.page, ...image.context, intent: 'quote' }, image.blob)
    return () => previewDshQuote(null)
  }, [image, paper])
  useEffect(() => {
    const element = root.current
    if (!element) return
    let frame = 0
    const measure = () => {
      if (frame) return
      frame = requestAnimationFrame(() => { frame = 0; setGeometry({ viewport: element.getBoundingClientRect(), x: element.scrollLeft, y: element.scrollTop }) })
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') clear() }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()
    element.addEventListener('scroll', measure)
    window.addEventListener('resize', measure)
    document.addEventListener('keydown', escape)
    return () => { if (frame) cancelAnimationFrame(frame); observer.disconnect(); element.removeEventListener('scroll', measure); window.removeEventListener('resize', measure); document.removeEventListener('keydown', escape) }
  }, [root, paper.attachKey, paper.file])
  const ready = !!geometry
  useEffect(() => {
    const element = overlay.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      if (!root.current || drag.current) return
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? root.current.clientHeight : 1
      root.current.scrollTop += event.deltaY * unit; root.current.scrollLeft += event.deltaX * unit
    }
    // React's passive wheel listener cannot cancel the additional scroll of the outer chat.
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [root, ready])
  const getAnchor = useCallback(() => {
    const element = root.current
    if (!element || !region) return null
    const content = bounds(region), rect = element.getBoundingClientRect()
    const left = rect.left + content.left - element.scrollLeft, top = rect.top + content.top - element.scrollTop
    return visibleSelectionAnchor([{ left, top, right: left + content.width, bottom: top + content.height }], rect)
  }, [root, region])
  if (!geometry) return null
  const { viewport } = geometry
  const point = (event: PointerEvent): Point => ({
    x: Math.max(0, Math.min(viewport.width, event.clientX - viewport.left)) + (root.current?.scrollLeft ?? 0),
    y: Math.max(0, Math.min(viewport.height, event.clientY - viewport.top)) + (root.current?.scrollTop ?? 0),
  })
  const filename = `${paper.file.replace(/\.pdf$/i, '')}-text-p${image?.page ?? 1}.png`
  const act = async (action: 'ask' | 'explain' | 'copy' | 'download') => {
    if (!image || busy) return
    setBusy(true)
    try {
      const blob = await image.blob
      if (action === 'explain') {
        await explainInDsh({ source: paperSource(paper), title: paper.title, page: image.page, ...image.context, intent: 'ask' }, new File([blob], filename, { type: 'image/png' }))
        onNotify('解释请求已发送'); clear()
      } else if (action === 'ask') {
        const accepted = sendCaptureToDsh({ source: paperSource(paper), title: paper.title, page: image.page, ...image.context, intent: 'ask' }, new File([blob], filename, { type: 'image/png' }))
        onNotify(accepted ? '截图已附加，可输入问题或直接发送解释' : '无法附加截图，请先打开会话，或下载后添加')
        if (accepted) clear()
      } else if (action === 'copy') {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        onNotify('已复制截图')
      } else {
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url; link.download = filename; link.click()
        window.setTimeout(() => URL.revokeObjectURL(url), 1500)
      }
    } catch (error) { onNotify(`截图失败：${(error as Error).message}`) }
    finally { setBusy(false) }
  }
  const contentBox = region ? bounds(region) : null
  const box = contentBox ? { ...contentBox, left: contentBox.left - geometry.x, top: contentBox.top - geometry.y } : null
  return <>
    <div ref={overlay} className="zr-text-capture-overlay" data-html2canvas-ignore="true" aria-label="拖动框选文本截图"
      style={{ left: viewport.left, top: viewport.top, width: root.current?.clientWidth ?? viewport.width,
        height: root.current?.clientHeight ?? viewport.height, overflow: 'hidden' }}
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary || busy) return
        event.preventDefault(); clear()
        const start = point(event)
        drag.current = { id: event.pointerId, start }
        setRegion({ start, end: start })
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={event => {
        if (drag.current?.id !== event.pointerId) return
        pendingRegion.current = { start: drag.current.start, end: point(event) }
        if (!dragFrame.current) dragFrame.current = requestAnimationFrame(() => {
          dragFrame.current = 0
          if (pendingRegion.current) setRegion(pendingRegion.current)
        })
      }}
      onPointerCancel={clear}
      onPointerUp={event => {
        const active = drag.current
        if (active?.id !== event.pointerId || !root.current) return
        stopDragFrame()
        drag.current = null
        const final = { start: active.start, end: point(event) }
        const content = bounds(final)
        const box = { ...content, left: content.left - root.current.scrollLeft, top: content.top - root.current.scrollTop }
        if (box.width < 5 || box.height < 5) { clear(); return }
        const article = [...root.current.querySelectorAll<HTMLElement>('[data-text-page]')].find(element => {
          const rect = element.getBoundingClientRect()
          return rect.bottom > viewport.top + box.top && rect.top < viewport.top + box.top + box.height
        })
        const blob = captureTextRegion(root.current, box)
        void blob.catch(() => {})
        setRegion(final)
        const context = textCaptureContext(root.current, { left: viewport.left + box.left, top: viewport.top + box.top,
          right: viewport.left + box.left + box.width, bottom: viewport.top + box.top + box.height })
        setImage({ blob, page: Number(article?.dataset.textPage) || 1, context })
      }}>
      {box ? <div className="zr-capture-region" style={box} /> : null}
    </div>
    {image && contentBox ? <CaptureToolbar busy={busy} getAnchor={getAnchor}>
      <button className="zr-selbar-btn" title="解释：直接发送给 AI" aria-label="解释截图" disabled={busy} onClick={() => void act('explain')}><Icon name="sparkle" /></button>
      <button className="zr-selbar-btn" title="引用截图" disabled={busy} onClick={() => void act('ask')}><Icon name="quote" /></button>
      <button className="zr-selbar-btn" title="复制截图" disabled={busy} onClick={() => void act('copy')}><Icon name="copy" /></button>
      <button className="zr-selbar-btn" title="下载截图" disabled={busy} onClick={() => void act('download')}><Icon name="download" /></button>
      <button className="zr-selbar-btn" title="取消截图" onClick={clear}><Icon name="close" /></button>
    </CaptureToolbar> : null}
  </>
}
