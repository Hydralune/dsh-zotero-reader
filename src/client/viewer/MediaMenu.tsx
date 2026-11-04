import { useEffect, useMemo, useRef, useState } from 'react'
import type { ZoteroPaper } from '../api'
import { explainInDsh, previewDshCapture, sendCaptureToDsh } from '../dshComposer'
import { Icon } from '../components/Icon'

export function MediaMenu({ x, y, page, canvas, paper, onClose, onNotify }: {
  x: number; y: number; page: number; canvas: HTMLCanvasElement; paper: ZoteroPaper
  onClose: () => void; onNotify: (text: string) => void
}) {
  const menu = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const image = useMemo(() => {
    const promise = new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片尚未加载完成')), 'image/png'))
    void promise.catch(() => {})
    return promise
  }, [canvas])
  useEffect(() => {
    canvas.parentElement?.classList.add('zr-media-selected')
    previewDshCapture({ title: paper.title, page, intent: 'quote' }, image)
    return () => canvas.parentElement?.classList.remove('zr-media-selected')
  }, [canvas, image, paper, page])
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) onClose() }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    document.addEventListener('scroll', onClose, true)
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); document.removeEventListener('scroll', onClose, true) }
  }, [onClose])
  const act = async (action: 'explain' | 'quote' | 'copy' | 'download') => {
    if (busy) return
    setBusy(true)
    try {
      const blob = await image
      const file = new File([blob], `${paper.file.replace(/\.pdf$/i, '')}-p${page}-image.png`, { type: 'image/png' })
      const parts = { title: paper.title, page, intent: 'ask' as const }
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
      onClose()
    } catch (error) { onNotify((error as Error).message) }
    finally { setBusy(false) }
  }
  return <div ref={menu} className="zr-media-menu" role="menu" aria-label="图片操作" aria-busy={busy}
    style={{ left: Math.max(8, Math.min(x, window.innerWidth - 184)), top: Math.max(8, Math.min(y, window.innerHeight - 172)) }}>
    <button role="menuitem" disabled={busy} onClick={() => void act('explain')}><Icon name="sparkle" /><span>解释</span><small>直接发送</small></button>
    <button role="menuitem" disabled={busy} onClick={() => void act('quote')}><Icon name="quote" /><span>引用</span></button>
    <button role="menuitem" disabled={busy} onClick={() => void act('copy')}><Icon name="copy" /><span>复制图片</span></button>
    <button role="menuitem" disabled={busy} onClick={() => void act('download')}><Icon name="download" /><span>下载图片</span></button>
  </div>
}
