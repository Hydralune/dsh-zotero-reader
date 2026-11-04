// Thumbs.tsx — 左栏缩略图。按需渲染、离开视口就停（86 页也只占几百 KB 内存）。
import { useEffect, useRef } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'

const THUMB_WIDTH = 132
const DPR = () => Math.min(window.devicePixelRatio || 1, 2)

export function Thumbs({
  doc,
  numPages,
  currentPage,
  onJump,
}: {
  doc: PDFDocumentProxy | null
  numPages: number
  currentPage: number
  onJump: (page: number) => void
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const doneRef = useRef(new Set<number>())
  const pendingRef = useRef(false)

  // 渲染队列：IntersectionObserver 只把「进入视口」的页丢进队列
  useEffect(() => {
    const root = scrollRef.current
    if (!root || !doc) return

    const render = async (pageNo: number, canvas: HTMLCanvasElement) => {
      if (doneRef.current.has(pageNo)) return
      doneRef.current.add(pageNo)
      try {
        const page = await doc.getPage(pageNo)
        const base = page.getViewport({ scale: 1 })
        const scale = THUMB_WIDTH / base.width
        const viewport = page.getViewport({ scale })
        const dpr = DPR()
        canvas.width = Math.floor(viewport.width * dpr)
        canvas.height = Math.floor(viewport.height * dpr)
        canvas.style.width = `${Math.floor(viewport.width)}px`
        canvas.style.height = `${Math.floor(viewport.height)}px`
        const ctx = canvas.getContext('2d', { alpha: false })
        if (!ctx) return
        await page.render({
          canvas,
          canvasContext: ctx,
          viewport,
          transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
        }).promise
      } catch {
        doneRef.current.delete(pageNo)
      }
    }

    const queue: Array<{ pageNo: number; canvas: HTMLCanvasElement }> = []
    const pump = async () => {
      if (pendingRef.current) return
      pendingRef.current = true
      while (queue.length) {
        const job = queue.shift()
        if (!job) break
        await render(job.pageNo, job.canvas)
      }
      pendingRef.current = false
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const el = entry.target as HTMLElement
          const pageNo = Number(el.dataset.page)
          const canvas = el.querySelector('canvas')
          if (!pageNo || !canvas) continue
          queue.push({ pageNo, canvas })
          io.unobserve(el)
        }
        void pump()
      },
      { root, rootMargin: '400px' },
    )
    for (const el of root.querySelectorAll<HTMLElement>('.zr-thumb')) io.observe(el)
    return () => io.disconnect()
  }, [doc, numPages])

  if (!numPages) {
    return <div className="zr-muted" style={{ padding: 12 }}>没有页面</div>
  }

  return (
    <div className="zr-thumbs" ref={scrollRef}>
      {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNo) => (
        <button
          key={pageNo}
          className="zr-thumb"
          data-page={pageNo}
          data-active={currentPage === pageNo ? '' : undefined}
          onClick={() => onJump(pageNo)}
          title={`第 ${pageNo} 页`}
        >
          <canvas />
          <span>{pageNo}</span>
        </button>
      ))}
    </div>
  )
}

export default Thumbs
