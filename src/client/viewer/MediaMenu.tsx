import { useEffect, useMemo, useRef, useState } from 'react'
import type { ZoteroPaper } from '../api'
import { paperSource, explainInDsh, getQuotePreview, previewDshCapture, previewDshQuote, sendCaptureToDsh } from '../dshComposer'
import { Icon } from '../components/Icon'
import { textCaptureContext } from './quote-context'
import { isScrollbarInteraction, visibleSelectionAnchor } from './selection-anchor'

export function MediaMenu({ x, y, page, canvas, paper, onClose, onNotify }: {
  x: number; y: number; page: number; canvas: HTMLCanvasElement; paper: ZoteroPaper
  onClose: () => void; onNotify: (text: string) => void
}) {
  const menu = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  const [busy, setBusy] = useState(false)
  const offset = useMemo(() => {
    const rect = canvas.getBoundingClientRect()
    return { x: x - rect.left, y: y - rect.top }
  }, [canvas, x, y])
  const locate = () => {
    const root = canvas.closest<HTMLElement>('.zr-textscroll')
    if (!root || !canvas.isConnected) return null
    const rect = canvas.getBoundingClientRect(), viewport = root.getBoundingClientRect()
    if (!visibleSelectionAnchor([rect], viewport)) return null
    return { left: Math.max(viewport.left + 8, Math.min(rect.left + offset.x, viewport.right - 184)),
      top: Math.max(viewport.top + 8, Math.min(rect.top + offset.y, viewport.bottom - 172)) }
  }
  const [position, setPosition] = useState(locate)
  useEffect(() => {
    let frame = 0
    const update = () => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; setPosition(locate()) })
    }
    const observer = new ResizeObserver(update)
    observer.observe(canvas)
    const root = canvas.closest<HTMLElement>('.zr-textscroll')
    if (root) observer.observe(root)
    document.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    update()
    return () => {
      observer.disconnect()
      document.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [canvas, offset])
  const image = useMemo(() => {
    const promise = new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片尚未加载完成')), 'image/png'))
    void promise.catch(() => {})
    return promise
  }, [canvas])
  const sourceContext = useMemo(() => {
    const root = canvas.closest<HTMLElement>('.zr-textscroll')
    return root ? textCaptureContext(root, canvas.getBoundingClientRect()) : {}
  }, [canvas])
  useEffect(() => {
    canvas.parentElement?.classList.add('zr-media-selected')
    previewDshCapture({ source: paperSource(paper), title: paper.title, page, ...sourceContext, intent: 'quote' }, image)
    return () => {
      canvas.parentElement?.classList.remove('zr-media-selected')
      if (getQuotePreview()?.image === image) previewDshQuote(null)
    }
  }, [canvas, image, paper, page, sourceContext])
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.button !== 0 || menu.current?.contains(event.target as Node)) return
      const root = canvas.closest<HTMLElement>('.zr-textscroll')
      if (root?.contains(event.target as Node) && !isScrollbarInteraction(event, root)) close.current()
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close.current() }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [canvas])
  const act = async (action: 'explain' | 'quote' | 'copy' | 'download') => {
    if (busy) return
    setBusy(true)
    try {
      const blob = await image
      const file = new File([blob], `${paper.file.replace(/\.pdf$/i, '')}-p${page}-image.png`, { type: 'image/png' })
      const parts = { source: paperSource(paper), title: paper.title, page, ...sourceContext, intent: 'ask' as const }
      if (action === 'explain') { await explainInDsh(parts, file); onNotify('解释请求已发送') }
      else if (action === 'quote') {
        if (!sendCaptureToDsh(parts, file)) throw new Error('无法附加图片，请先打开会话')
        onNotify('图片已引用，可继续输入问题')
      } else if (action === 'copy') {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); onNotify('已复制图片')
      } else {
        const url = URL.createObjectURL(blob), link = document.createElement('a')
        link.href = url; link.download = file.name; link.click()
        window.setTimeout(() => URL.revokeObjectURL(url), 1500)
      }
    } catch (error) { onNotify((error as Error).message) }
    finally { setBusy(false) }
  }
  return <div ref={menu} className="zr-media-menu" role="menu" aria-label="图片操作" aria-busy={busy}
    style={position ? position : { display: 'none' }} onContextMenu={event => event.preventDefault()}
    onMouseDown={event => event.preventDefault()}>
    <button role="menuitem" disabled={busy} onClick={() => void act('explain')}><Icon name="sparkle" /><span>解释</span><small>直接发送</small></button>
    <button role="menuitem" disabled={busy} onClick={() => void act('quote')}><Icon name="quote" /><span>引用</span></button>
    <button role="menuitem" disabled={busy} onClick={() => void act('copy')}><Icon name="copy" /><span>复制图片</span></button>
    <button role="menuitem" disabled={busy} onClick={() => void act('download')}><Icon name="download" /><span>下载图片</span></button>
  </div>
}
