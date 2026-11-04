import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { SelectionAnchor } from './selection-anchor'

/** Keep capture actions attached to their source without discarding offscreen captures. */
export function CaptureToolbar({ getAnchor, children, busy = false }: {
  getAnchor: () => SelectionAnchor | null; children: ReactNode; busy?: boolean
}) {
  const [anchor, setAnchor] = useState<SelectionAnchor | null>(() => getAnchor())
  const locate = useRef(getAnchor)
  locate.current = getAnchor
  useEffect(() => {
    let frame = 0
    const update = () => {
      if (frame) return
      frame = requestAnimationFrame(() => { frame = 0; setAnchor(locate.current()) })
    }
    update()
    document.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    const observer = new ResizeObserver(update)
    document.querySelectorAll('.zr-textscroll,.zr-pdf-scroll').forEach(element => observer.observe(element))
    return () => {
      observer.disconnect()
      document.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [getAnchor])
  if (!anchor) return null
  const viewport = anchor.viewport ?? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
  const width = 190, height = 40
  const left = Math.max(viewport.left + 8, Math.min(anchor.x - width / 2, viewport.right - width - 8))
  const top = anchor.y - height - 8 >= viewport.top + 8 ? anchor.y - height - 8 :
    Math.min(anchor.bottom + 8, viewport.bottom - height - 8)
  return <div className="zr-selbar zr-capture-tools" data-html2canvas-ignore="true" aria-busy={busy}
    style={{ left, top }} onMouseDown={event => event.preventDefault()}>{children}</div>
}
