// HighlightLayer.tsx — 一页上的高亮/下划线/删除线。
// 坐标是归一化的（0..1），所以缩放、切页、换窗口都不用重算。
import type { CSSProperties } from 'react'
import type { NoteMark } from '../api'

function styleFor(mark: NoteMark, rect: { x: number; y: number; w: number; h: number }): CSSProperties {
  const base: CSSProperties = {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.w * 100}%`,
    height: `${rect.h * 100}%`,
  }
  if (mark.kind === 'underline') {
    return { ...base, borderBottom: `2px solid ${mark.color}`, height: 'auto', bottom: 'auto' }
  }
  if (mark.kind === 'strike') {
    return { ...base, backgroundImage: `linear-gradient(${mark.color},${mark.color})`, backgroundSize: '100% 1.5px', backgroundPosition: '0 55%', backgroundRepeat: 'no-repeat' }
  }
  return { ...base, background: mark.color }
}

export function HighlightLayer({
  page,
  marks,
  activeId,
}: {
  page: number
  marks: NoteMark[]
  activeId?: string | null
}) {
  const pageMarks = marks.filter((m) => m.page === page)
  if (!pageMarks.length) return null

  return (
    <div className="zr-hl-layer">
      {pageMarks.map((mark) =>
        <div key={mark.id} className={mark.kind === 'highlight' ? 'zr-hl-group' : undefined}>
          {mark.rects.map((rect, i) => (
          <div
            key={`${mark.id}-${i}`}
            className="zr-hl"
            data-kind={mark.kind}
            data-active={activeId === mark.id ? '' : undefined}
            style={styleFor(mark, rect)}
            title={mark.text.slice(0, 300)}
          />
          ))}
        </div>,
      )}
    </div>
  )
}

export default HighlightLayer
