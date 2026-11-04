import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react'
import html2canvas from 'html2canvas'
import type { ZoteroPaper } from '../api'
import { explainInDsh, previewDshCapture, previewDshQuote, sendCaptureToDsh } from '../dshComposer'
import { Icon } from '../components/Icon'

type Point = { x: number; y: number }
type Region = { start: Point; end: Point }
const bounds = ({ start, end }: Region) => ({ left: Math.min(start.x, end.x), top: Math.min(start.y, end.y),
  width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) })

export async function captureTextRegion(root: HTMLElement, region: ReturnType<typeof bounds>): Promise<Blob> {
  await document.fonts.ready
  const rect = root.getBoundingClientRect()
  const scale = Math.min(2, window.devicePixelRatio || 1)
  const canvas = await html2canvas(root, {
    logging: false, backgroundColor: '#ffffff', scale,
    width: rect.width, height: rect.height,
    ignoreElements: element => element.hasAttribute('data-html2canvas-ignore'),
  })
  const crop = document.createElement('canvas')
  crop.width = Math.max(1, Math.round(region.width * scale))
  crop.height = Math.max(1, Math.round(region.height * scale))
  const context = crop.getContext('2d')
  if (!context) throw new Error('无法创建截图')
  context.drawImage(canvas, region.left * scale, region.top * scale, region.width * scale, region.height * scale,
    0, 0, crop.width, crop.height)
  return new Promise((resolve, reject) => crop.toBlob(blob => blob ? resolve(blob) : reject(new Error('截图生成失败')), 'image/png'))
}

export function TextCapture({ root, paper, onNotify }: {
  root: RefObject<HTMLDivElement | null>; paper: ZoteroPaper; onNotify: (message: string) => void
}) {
  const [viewport, setViewport] = useState<DOMRect | null>(null)
  const [region, setRegion] = useState<Region | null>(null)
  const [image, setImage] = useState<{ blob: Promise<Blob>; page: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const drag = useRef<{ id: number; start: Point } | null>(null)
  const clear = () => { drag.current = null; setRegion(null); setImage(null) }
  useEffect(() => {
    if (image) previewDshCapture({ title: paper.title, page: image.page, intent: 'quote' }, image.blob)
    return () => previewDshQuote(null)
  }, [image, paper])
  useEffect(() => {
    const element = root.current
    if (!element) return
    const measure = () => { setViewport(element.getBoundingClientRect()); clear() }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') clear() }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()
    element.addEventListener('scroll', measure)
    window.addEventListener('resize', measure)
    document.addEventListener('keydown', escape)
    return () => { observer.disconnect(); element.removeEventListener('scroll', measure); window.removeEventListener('resize', measure); document.removeEventListener('keydown', escape) }
  }, [root, paper.attachKey, paper.file])
  if (!viewport) return null
  const point = (event: PointerEvent): Point => ({
    x: Math.max(0, Math.min(viewport.width, event.clientX - viewport.left)),
    y: Math.max(0, Math.min(viewport.height, event.clientY - viewport.top)),
  })
  const filename = `${paper.file.replace(/\.pdf$/i, '')}-text-p${image?.page ?? 1}.png`
  const act = async (action: 'ask' | 'explain' | 'copy' | 'download') => {
    if (!image || busy) return
    setBusy(true)
    try {
      const blob = await image.blob
      if (action === 'explain') {
        await explainInDsh({ title: paper.title, page: image.page, intent: 'ask' }, new File([blob], filename, { type: 'image/png' }))
        onNotify('解释请求已发送'); clear()
      } else if (action === 'ask') {
        const accepted = sendCaptureToDsh({ title: paper.title, page: image.page, intent: 'ask' }, new File([blob], filename, { type: 'image/png' }))
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
  const box = region ? bounds(region) : null
  return <>
    <div className="zr-text-capture-overlay" data-html2canvas-ignore="true" aria-label="拖动框选文本截图"
      style={{ left: viewport.left, top: viewport.top, width: viewport.width, height: viewport.height }}
      onWheel={event => { if (root.current && !drag.current) root.current.scrollTop += event.deltaY }}
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary || busy) return
        event.preventDefault(); clear()
        const start = point(event)
        drag.current = { id: event.pointerId, start }
        setRegion({ start, end: start })
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={event => {
        if (drag.current?.id === event.pointerId) setRegion({ start: drag.current.start, end: point(event) })
      }}
      onPointerCancel={clear}
      onPointerUp={event => {
        const active = drag.current
        if (active?.id !== event.pointerId || !root.current) return
        drag.current = null
        const final = { start: active.start, end: point(event) }
        const box = bounds(final)
        if (box.width < 5 || box.height < 5) { clear(); return }
        const article = [...root.current.querySelectorAll<HTMLElement>('[data-text-page]')].find(element => {
          const rect = element.getBoundingClientRect()
          return rect.bottom > viewport.top + box.top && rect.top < viewport.top + box.top + box.height
        })
        const blob = captureTextRegion(root.current, box)
        void blob.catch(() => {})
        setRegion(final)
        setImage({ blob, page: Number(article?.dataset.textPage) || 1 })
      }}>
      {box ? <div className="zr-capture-region" style={box} /> : null}
    </div>
    {image && box ? <div className="zr-selbar" data-html2canvas-ignore="true" aria-busy={busy}
      style={{ left: Math.max(8, Math.min(viewport.left + box.left, window.innerWidth - 190)), top: Math.max(8, viewport.top + box.top - 45) }}
      onMouseDown={event => event.preventDefault()}>
      <button className="zr-selbar-btn" title="解释：直接发送给 AI" aria-label="解释截图" disabled={busy} onClick={() => void act('explain')}><Icon name="sparkle" /></button>
      <button className="zr-selbar-btn" title="引用截图" disabled={busy} onClick={() => void act('ask')}><Icon name="quote" /></button>
      <button className="zr-selbar-btn" title="复制截图" disabled={busy} onClick={() => void act('copy')}><Icon name="copy" /></button>
      <button className="zr-selbar-btn" title="下载截图" disabled={busy} onClick={() => void act('download')}><Icon name="download" /></button>
      <button className="zr-selbar-btn" title="取消截图" onClick={clear}><Icon name="close" /></button>
    </div> : null}
  </>
}
