import { useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { confirmDshQuote, getQuotePreview, previewDshQuote, subscribeQuotePreview } from '../dshComposer'
import { Icon } from './Icon'

/** A provisional reference beside the native editor; confirmation uses its file rail. */
export function QuotePreview() {
  const preview = useSyncExternalStore(subscribeQuotePreview, getQuotePreview)
  const [target, setTarget] = useState<HTMLElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setError('') }, [preview])
  useEffect(() => {
    if (!preview) { setTarget(null); return }
    const host = document.createElement('div')
    host.className = 'zr-quote-preview-host'
    const parent = preview.box.closest('[data-composer-card]') ?? preview.box.parentElement
    if (!parent || !preview.box.isConnected) return
    parent.prepend(host)
    setTarget(host)
    return () => { host.remove() }
  }, [preview?.box, !!preview])
  if (!preview || !target) return null
  return createPortal(
    <div className="zr-quote-preview" aria-busy={busy}
      onPointerDown={event => { event.preventDefault(); event.stopPropagation() }}
      onMouseDown={event => { event.preventDefault(); event.stopPropagation() }}>
      <Icon name={preview.image ? 'capture' : 'quote'} />
      <div className="zr-quote-preview-body">
        <small>待引用{preview.image ? ' · 截图' : ''} · 第 {preview.parts.page ?? 1} 页 · {preview.parts.title}</small>
        <span>{error || (preview.image ? '已框选截图，确认后附加到当前问题' : preview.parts.text?.replace(/\s+/g, ' ').slice(0, 120))}</span>
      </div>
      <button type="button" className="zr-quote-preview-button" aria-label="确认引用" title="附加引用，可直接发送或继续输入问题"
        disabled={busy} onClick={() => {
          setBusy(true)
          void confirmDshQuote().then(ok => { if (!ok) setError('附加失败，请先点击对话输入框后重试') })
            .catch(() => setError('附件生成失败，请重新选择')).finally(() => setBusy(false))
        }}><Icon name="check" /></button>
      <button type="button" className="zr-quote-preview-button" aria-label="取消待引用" onClick={() => previewDshQuote(null)}><Icon name="close" /></button>
    </div>, target,
  )
}
