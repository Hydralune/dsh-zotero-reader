import { useLayoutEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'

export function TranslationCard({ x, y, text, loading = false, onClose }: {
  x: number; y: number; text: string; loading?: boolean; onClose: () => void
}) {
  const card = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y, width: 360, maxHeight: 320 })
  useLayoutEffect(() => {
    const element = card.current
    if (!element) return
    const measure = () => {
      const root = element.closest('.zr-page')?.getBoundingClientRect()
      const left = Math.max(0, root?.left ?? 0), right = Math.min(window.innerWidth, root?.right ?? window.innerWidth)
      const top = Math.max(0, root?.top ?? 0), bottom = Math.min(window.innerHeight, root?.bottom ?? window.innerHeight)
      const width = Math.min(360, right - left - 24), maxHeight = Math.min(320, bottom - top - 24)
      setPosition({ left: Math.max(left + 12, Math.min(x, right - width - 12)),
        top: Math.max(top + 12, Math.min(y, bottom - Math.min(element.offsetHeight, maxHeight) - 12)), width, maxHeight })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    const root = element.closest('.zr-page')
    if (root) observer.observe(root)
    window.addEventListener('resize', measure)
    return () => { observer.disconnect(); window.removeEventListener('resize', measure) }
  }, [x, y, text, loading])
  return <div ref={card} className="zr-translation-card" style={position} role="region" aria-label="划词翻译"
    aria-busy={loading} onMouseDown={event => event.stopPropagation()}>
    <div className="zr-translation-card-header"><Icon name="translate" size={15} /><span>划词翻译</span>
      <button type="button" className="zr-btn zr-btn-icon" aria-label="关闭翻译" onClick={onClose}><Icon name="close" size={14} /></button>
    </div>
    <div className="zr-translation-card-body" aria-live="polite">{loading ? '正在翻译所选内容…' : text}</div>
  </div>
}
