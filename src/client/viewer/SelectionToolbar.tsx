// SelectionToolbar.tsx — 划词工具条（重绘：更大的点击区、更清楚的图标、分组的节奏感）。
//
// 结构：主条一行三组 —— 问 AI/翻译 · 高亮系（含色板） · 复制/引用；
// 点色块展开 9 色调色板，选完自动收起。
import { useEffect, useRef, useState } from 'react'
import type { MarkKind } from '../api'


import { Icon } from '../components/Icon'

export const MARK_COLORS = [
  '#ffeb3b',
  '#ffc107',
  '#ff9800',
  '#f44336',
  '#e91e63',
  '#9c27b0',
  '#3f51b5',
  '#2196f3',
  '#4caf50',
]

export interface SelectionToolbarProps {
  anchor: { x: number; y: number; bottom: number }
  onExplain: () => void | Promise<void>
  onTranslate: () => void
  onMark: (kind: MarkKind, color: string) => void
  onCopy: () => void
  onQuote: () => void
  onClose: () => void
}

const WIDTH = 284
const BAR_HEIGHT = 40
const PALETTE_HEIGHT = 40

export function SelectionToolbar({
  anchor,
  onExplain,
  onTranslate,
  onMark,
  onCopy,
  onQuote,
  onClose,
}: SelectionToolbarProps) {
  const [palette, setPalette] = useState(false)
  const [explaining, setExplaining] = useState(false)
  const [color, setColor] = useState(MARK_COLORS[0])
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [onClose])

  const totalHeight = BAR_HEIGHT + (palette ? PALETTE_HEIGHT : 0)
  const left = Math.min(Math.max(8, anchor.x - WIDTH / 2), window.innerWidth - WIDTH - 8)
  // 贴选区**上方**（tippy placement:'top' 的效果）；上方放不下才翻到下方。
  let top = anchor.y - totalHeight - 8
  if (top < 8) top = Math.min(anchor.bottom + 8, window.innerHeight - totalHeight - 8)

  return (
    <div
      className="zr-selbar zr-selection-tools"
      ref={ref}
      style={{ left, top, width: WIDTH, flexDirection: 'column', alignItems: 'stretch' }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="zr-selbar-row">
        <button className="zr-selbar-btn" title="解释：直接发送给 AI" aria-label="解释选中文字" disabled={explaining}
          onClick={() => { setExplaining(true); void Promise.resolve(onExplain()).finally(() => setExplaining(false)) }}><Icon name="sparkle" /></button>
        <button className="zr-selbar-btn" title="翻译这一段" onClick={onTranslate}>
          <Icon name="translate" />
        </button>

        <span className="zr-selbar-sep" />

        <button className="zr-selbar-btn" title="高亮" onClick={() => onMark('highlight', color)}>
          <Icon name="highlight" />
        </button>
        <button
          className="zr-selbar-btn zr-selbar-color"
          title="选择颜色"
          data-active={palette ? '' : undefined}
          onClick={() => setPalette((v) => !v)}
        >
          <span className="zr-color-dot" style={{ background: color }} />
        </button>
        <button className="zr-selbar-btn" title="下划线" onClick={() => onMark('underline', color)}>
          <Icon name="underline" />
        </button>
        <button className="zr-selbar-btn" title="删除线" onClick={() => onMark('strike', color)}>
          <Icon name="strike" />
        </button>

        <span className="zr-selbar-sep" />

        <button className="zr-selbar-btn" title="复制" onClick={onCopy}>
          <Icon name="copy" />
        </button>
        <button className="zr-selbar-btn" title="引用到对话" onClick={onQuote}>
          <Icon name="quote" />
        </button>
      </div>

      {palette ? (
        <div className="zr-selbar-palette">
          {MARK_COLORS.map((c) => (
            <button
              key={c}
              className="zr-swatch-btn"
              style={{ background: c }}
              data-active={c === color ? '' : undefined}
              title={c}
              onClick={() => {
                setColor(c)
                setPalette(false)
              }}
            >
              {c === color ? (
                <Icon name="check" />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default SelectionToolbar
