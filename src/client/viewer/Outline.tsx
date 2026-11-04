// Outline.tsx — PDF 内置书签（目录）。
// dest 可能是显式引用（[ref, ...]）或命名目标（字符串），两种都解析成页码。
import { useEffect, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'

interface OutlineNode {
  title: string
  page: number | null
  children: OutlineNode[]
}

type RawDest = unknown

/** 把 pdf.js 的 dest 解析成 1 起的页码 */
async function resolvePage(doc: PDFDocumentProxy, dest: RawDest): Promise<number | null> {
  try {
    let target = dest
    if (typeof target === 'string') target = await doc.getDestination(target)
    if (!Array.isArray(target) || target.length === 0) return null
    const first = target[0]
    if (typeof first === 'object' && first !== null) {
      const index = await doc.getPageIndex(first as { num: number; gen: number })
      return index + 1
    }
    if (typeof first === 'number') return first + 1
  } catch {
    /* 目标失效 */
  }
  return null
}

async function buildTree(
  doc: PDFDocumentProxy,
  items: Array<{ title: string; dest?: RawDest; items?: unknown[] }>,
  depth = 0,
): Promise<OutlineNode[]> {
  const out: OutlineNode[] = []
  for (const item of items) {
    const children =
      Array.isArray(item.items) && depth < 6
        ? await buildTree(doc, item.items as Array<{ title: string; dest?: RawDest; items?: unknown[] }>, depth + 1)
        : []
    out.push({
      title: item.title?.trim() || '(未命名)',
      page: item.dest ? await resolvePage(doc, item.dest) : null,
      children,
    })
  }
  return out
}

function Node({
  node,
  depth,
  currentPage,
  onJump,
}: {
  node: OutlineNode
  depth: number
  currentPage: number
  onJump: (page: number) => void
}) {
  const [open, setOpen] = useState(depth < 1)
  const hasChildren = node.children.length > 0
  const active = node.page === currentPage

  return (
    <div>
      <div className="zr-outline-row" data-active={active ? '' : undefined} style={{ paddingLeft: 6 + depth * 12 }}>
        <button
          className="zr-outline-toggle"
          onClick={() => setOpen(!open)}
          style={{ visibility: hasChildren ? 'visible' : 'hidden' }}
          title={open ? '收起' : '展开'}
        >
          {open ? '▾' : '▸'}
        </button>
        <button
          className="zr-outline-title"
          onClick={() => {
            if (node.page) onJump(node.page)
            else if (hasChildren) setOpen(!open)
          }}
          title={node.title}
        >
          {node.title}
        </button>
        {node.page ? <span className="zr-outline-page">{node.page}</span> : null}
      </div>
      {hasChildren && open
        ? node.children.map((child, i) => (
            <Node key={`${child.title}-${i}`} node={child} depth={depth + 1} currentPage={currentPage} onJump={onJump} />
          ))
        : null}
    </div>
  )
}

export function Outline({
  doc,
  currentPage,
  onJump,
}: {
  doc: PDFDocumentProxy | null
  currentPage: number
  onJump: (page: number) => void
}) {
  const [tree, setTree] = useState<OutlineNode[] | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!doc) {
      setTree(null)
      return
    }
    setLoading(true)
    doc
      .getOutline()
      .then(async (raw) => {
        if (cancelled) return
        if (!raw || raw.length === 0) {
          setTree([])
          return
        }
        setTree(await buildTree(doc, raw as Array<{ title: string; dest?: RawDest; items?: unknown[] }>))
      })
      .catch(() => {
        if (!cancelled) setTree([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [doc])

  if (loading) return <div className="zr-muted" style={{ padding: 12 }}>读取目录…</div>
  if (!tree || tree.length === 0) return <div className="zr-muted" style={{ padding: 12 }}>这份 PDF 没有内置目录</div>

  return (
    <div className="zr-outline">
      {tree.map((node, i) => (
        <Node key={`${node.title}-${i}`} node={node} depth={0} currentPage={currentPage} onJump={onJump} />
      ))}
    </div>
  )
}

export default Outline
