// MarkPopover.tsx — 点高亮后的小浮层：看原文、改色、改形态、删、问 AI。
import { useState } from 'react'
import type { MarkKind, NoteMark } from '../api'
import { Icon } from '../components/Icon'
import { MARK_COLORS } from './SelectionToolbar'

const KINDS: Array<{ value: MarkKind; label: string }> = [
  { value: 'highlight', label: '高亮' },
  { value: 'underline', label: '下划线' },
  { value: 'strike', label: '删除线' },
]

export function MarkPopover({
  mark,
  point,
  onPatch,
  onDelete,
  onAsk,
  onClose,
}: {
  mark: NoteMark
  point: { x: number; y: number }
  onPatch: (patch: { color?: string; kind?: MarkKind }) => void
  onDelete: () => void
  onAsk: () => void
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const W = 300
  const left = Math.min(Math.max(8, point.x - W / 2), window.innerWidth - W - 8)
  const top = Math.min(Math.max(8, point.y + 14), window.innerHeight - 220)

  return (
    <div
      className="zr-selbar"
      style={{ left, top, width: W, padding: '8px 10px', display: 'block' }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="zr-row" style={{ marginBottom: 6 }}>
        <span className="zr-note-dot" style={{ background: mark.color }} />
        <span className="zr-muted" style={{ fontSize: 11 }}>
          p.{mark.page} · {mark.kind === 'highlight' ? '高亮' : mark.kind === 'underline' ? '下划线' : '删除线'}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
          <button className="zr-selbar-btn" title="解释：直接发送给 AI" onClick={onAsk}>
            <Icon name="sparkle" />
          </button>
          <button
            className="zr-selbar-btn"
            title="删除"
            onClick={() => {
              setBusy(true)
              onDelete()
            }}
            disabled={busy}
          >
            <Icon name="close" />
          </button>
          <button className="zr-selbar-btn" title="关闭" onClick={onClose}>
            <Icon name="chevronDown" />
          </button>
        </span>
      </div>

      <div className="zr-mark-text">{mark.text.slice(0, 400) || '（这段没有提取到文字）'}</div>

      <div className="zr-selbar-palette" style={{ borderTop: 'none', padding: '6px 0 2px', justifyContent: 'flex-start' }}>
        {MARK_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className="zr-swatch-btn"
            style={{ background: c }}
            data-active={c === mark.color ? '' : undefined}
            title={c}
            onClick={() => onPatch({ color: c })}
          />
        ))}
      </div>

      <div className="zr-row" style={{ marginTop: 8, gap: 4 }}>
        {KINDS.map((k) => (
          <button
            key={k.value}
            className="zr-chip"
            data-active={mark.kind === k.value ? '' : undefined}
            onClick={() => onPatch({ kind: k.value })}
          >
            {k.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export default MarkPopover
