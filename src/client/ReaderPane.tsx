// ReaderPane.tsx — 停靠在 DSH 右侧栏的论文阅读面板。
//
// 布局契约（用户明确要求）：**对话永远在中间不被打断，论文只在最右侧**。
// 所以这里没有自绘聊天框——问 AI 走「把选区塞进 DSH 输入框」，答案出现在中间的会话里。
//
//   ┌ 顶栏 [文献▾] 3/86 [−][120%][+] [PDF|文本] [译] ┐
//   ├ 画布（pdf.js 或结构化文本）                     ┤
//   └ 抽屉（文献 / 目录 / 笔记 / 缩略）← 覆盖在画布上 ┘
//
// 面板宽度只有 300~560px，所以左栏不能常驻：改成可收起的抽屉。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import {
  ApiError,
  addNotes,
  deleteNote,
  getNotes,
  getZoteroLibrary,
  notesExportUrl,
  pdfUrl,
  getReaderSetup,
  claimReaderWelcome,
  type ReaderSetup,
  importZoteroPdf,
  translateText,
  updateNote,
  type MarkKind,
  type NoteMark,
  type ZoteroLibrary,
  type ZoteroPaper,
} from './api'
import { Icon } from './components/Icon'
import { PaperSummary } from './components/PaperSummary'
import { paperSource, explainInDsh, previewDshCapture, previewDshQuote, sendCaptureToDsh, sendToDsh } from './dshComposer'
import { QuotePreview } from './components/QuotePreview'
import type { ReaderLocation } from './api'
import { installStyles } from './theme'
import { PdfViewer, type PdfViewerHandle, type PdfCapture } from './viewer/PdfViewer'
import { Thumbs } from './viewer/Thumbs'
import { Outline } from './viewer/Outline'
import { SetupGuide } from './SetupGuide'
import { TextViewer } from './viewer/TextViewer'
import { TranslateMenu } from './viewer/TranslateMenu'
import { MarkPopover } from './viewer/MarkPopover'
import { SelectionToolbar, MARK_COLORS } from './viewer/SelectionToolbar'
import { clearSelection, readSelection, type SelectionSnapshot } from './viewer/selection'
import { isScrollbarInteraction, visibleSelectionAnchor } from './viewer/selection-anchor'
import { CaptureToolbar } from './viewer/CaptureToolbar'

type Drawer = 'library' | 'outline' | 'notes' | 'thumbs' | null

const DRAWER_TABS: Array<{ id: Exclude<Drawer, null>; label: string }> = [
  { id: 'library', label: '文献' },
  { id: 'outline', label: '目录' },
  { id: 'notes', label: '笔记' },
  { id: 'thumbs', label: '缩略' },
]

const ZOOM_STEP = 0.15
const ZOOM_MIN = 0.4
const ZOOM_MAX = 4

const KIND_LABEL: Record<MarkKind, string> = {
  highlight: '高亮',
  underline: '下划线',
  strike: '删除线',
}

export function ReaderPane() {
  installStyles()

  const [library, setLibrary] = useState<ZoteroLibrary | null>(null)
  const [libError, setLibError] = useState('')
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [drawer, setDrawer] = useState<Drawer>('library')
  const [paper, setPaper] = useState<ZoteroPaper | null>(null)
  const [variant, setVariant] = useState('')
  const [quickOpen, setQuickOpen] = useState(false)
  const [setup, setSetup] = useState<ReaderSetup | null>(null)
  const [setupOpen, setSetupOpen] = useState(false)
  useEffect(() => {
    let mounted = true
    void getReaderSetup().then((next) => {
      if (!mounted) return
      setSetup(next)
      if (!next.completed) {
        void claimReaderWelcome().then(({ show }) => {
          if (mounted && show) setSetupOpen(true)
        }).catch(() => {})
      }
    }).catch(() => {})
    return () => { mounted = false }
  }, [])
  const [captureMode, setCaptureMode] = useState(false)
  const [capture, setCapture] = useState<PdfCapture | null>(null)
  const [view, setView] = useState<'pdf' | 'text'>('pdf')
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [page, setPage] = useState(1)
  const [scale, setScale] = useState(1.1)
  /** true = 跟随面板宽度自动缩放（手动缩放后关闭，点「适应宽度」恢复） */
  const [autoFit, setAutoFit] = useState(true)
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [findHits, setFindHits] = useState<Array<{ page: number; count: number }>>([])
  const [findIndex, setFindIndex] = useState(0)
  const [toast, setToast] = useState('')

  const [marks, setMarks] = useState<NoteMark[]>([])
  const [activeMarkId, setActiveMarkId] = useState<string | null>(null)
  const [markPop, setMarkPop] = useState<{ mark: NoteMark; x: number; y: number } | null>(null)
  const [preview, setPreview] = useState<SelectionSnapshot | null>(null)
  const pdfSelectionSource = useRef('')
  const [sel, setSel] = useState<SelectionSnapshot | null>(null)
  const [translateCard, setTranslateCard] = useState<{ x: number; y: number; text: string; loading: boolean } | null>(null)
  const [bilingual, setBilingual] = useState(false)
  const [translateOpen, setTranslateOpen] = useState(false)

  const pendingTextJump = useRef<ReaderLocation | null>(null)
  const [pdfLocation, setPdfLocation] = useState<ReaderLocation | null>(null)
  const [textPoint, setTextPoint] = useState<{ page: number; x: number; y: number } | null>(null)
  const viewerRef = useRef<PdfViewerHandle | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const findInputRef = useRef<HTMLInputElement | null>(null)

  const say = useCallback((text: string) => {
    setToast(text)
    window.setTimeout(() => setToast((cur) => (cur === text ? '' : cur)), 2200)
  }, [])

  /* ---------------- 文献库 ---------------- */
  const loadLibrary = useCallback(async () => {
    setLoading(true)
    setLibError('')
    try {
      const lib = await getZoteroLibrary()
      setLibrary(lib)
      // 只有一个候选时直接打开，省一次点击
      if (!paper && lib.papers.length === 1) {
        setPaper(lib.papers[0])
        setDrawer(null)
      }
    } catch (e) {
      setLibError((e as ApiError).message || String(e))
    } finally {
      setLoading(false)
    }
  }, [paper])

  useEffect(() => {
    void loadLibrary()
    // 只在挂载时扫一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filteredPapers = useMemo(() => {
    const papers = library?.papers ?? []
    const q = query.trim().toLowerCase()
    const hit = q
      ? papers.filter(
          (p) =>
            p.title.toLowerCase().includes(q) ||
            (p.creators ?? []).some((c) => `${c.lastName ?? ''}${c.firstName ?? ''}`.toLowerCase().includes(q)) ||
            (p.year ?? '').includes(q),
        )
      : papers
    return hit
  }, [library, query])

  const revealLibrary = () => {
    setQuickOpen(false)
    setQuery('')
    setDrawer((current) => current === 'library' ? null : 'library')
    void getZoteroLibrary().then(setLibrary).catch(() => {})
  }

  const pdfInput = useRef<HTMLInputElement>(null)
  const [importFolder, setImportFolder] = useState('')
  const [importingPdf, setImportingPdf] = useState(false)
  const [importMessage, setImportMessage] = useState('')
  const openPaper = useCallback((next: ZoteroPaper) => {
    setQuickOpen(false)
    pendingTextJump.current = null
    setPdfLocation(null)
    setTextPoint(null)
    setPaper(next)
    setDoc(null)
    setNumPages(0)
    setPage(1)
    setMarks([])
    setActiveMarkId(null)
    setSel(null)
    setMarkPop(null)
    setFindHits([])
    setFindQuery('')
    setFindOpen(false)
    setVariant('')
    setView('pdf')
    setDrawer(null)
    void getNotes(next)
      .then((r) => setMarks(r.marks))
      .catch(() => setMarks([]))
  }, [])

  const uploadPdf = async (file: File) => {
    setImportingPdf(true)
    setImportMessage('')
    try {
      if (file.size > 100 * 1024 * 1024) throw new Error('PDF 文件超过 100 MB')
      const result = await importZoteroPdf(file, importFolder ? Number(importFolder) : undefined)
      const refreshed = await getZoteroLibrary()
      setLibrary(refreshed)
      const added = refreshed.papers.find((item) => item.attachKey === result.attachKey)
      setImportMessage(result.warning || (added ? '' : '已存入 Zotero，可刷新文献库查看'))
      if (added) {
        setQuery('')
        openPaper(added)
        setView('text')
        say(result.warning || '已存入 Zotero，正在解析 PDF')
      }
    } catch (error) {
      setImportMessage((error as Error).message)
    } finally {
      setImportingPdf(false)
    }
  }

  /* ---------------- 适应宽度 ---------------- */
  useEffect(() => {
    if (!doc || view !== 'pdf' || !autoFit) return
    let cancelled = false
    const fit = async () => {
      const host = bodyRef.current
      if (!host) return
      const available = host.clientWidth - 24
      if (available <= 0) return
      try {
        const first = await doc.getPage(1)
        const base = first.getViewport({ scale: 1 }).width
        if (cancelled || !base) return
        setScale(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +(available / base).toFixed(3))))
      } catch {
        /* 页面还没准备好 */
      }
    }
    void fit()
    const host = bodyRef.current
    const observer = host ? new ResizeObserver(() => void fit()) : null
    if (host && observer) observer.observe(host)
    return () => {
      cancelled = true
      observer?.disconnect()
    }
  }, [doc, view, autoFit])

  /**
   * 兜底校验：算出来的比例仍让滚动容器横向溢出时（滚动条/内边距算漏了），按溢出比例再收一档。
   * 只修一次，避免来回抖。
   */
  const overflowFixed = useRef(0)
  useEffect(() => {
    if (!doc || view !== 'pdf' || !autoFit) return
    const timer = window.setTimeout(() => {
      const scroller = bodyRef.current?.querySelector<HTMLElement>('.zr-pdf-scroll')
      if (!scroller) return
      const overflow = scroller.scrollWidth - scroller.clientWidth
      if (overflow <= 1) return
      const ratio = (scroller.clientWidth - 2) / scroller.scrollWidth
      if (ratio <= 0 || ratio >= 1) return
      if (overflowFixed.current >= 3) return
      overflowFixed.current += 1
      setScale((s) => Math.max(ZOOM_MIN, +(s * ratio).toFixed(3)))
    }, 350)
    return () => window.clearTimeout(timer)
  }, [doc, view, autoFit, scale])

  /* ---------------- 搜索 ---------------- */
  const runSearch = useCallback(
    async (text: string) => {
      setFindQuery(text)
      if (!text.trim()) {
        viewerRef.current?.clearSearch()
        setFindHits([])
        return
      }
      const hits = (await viewerRef.current?.search(text)) ?? []
      setFindHits(hits)
      setFindIndex(0)
      if (hits.length) viewerRef.current?.jumpTo(hits[0].page)
      else say('没有找到匹配')
    },
    [say],
  )

  const stepSearch = useCallback(
    (delta: number) => {
      if (!findHits.length) return
      const next = (findIndex + delta + findHits.length) % findHits.length
      setFindIndex(next)
      viewerRef.current?.jumpTo(findHits[next].page)
    },
    [findHits, findIndex],
  )

  /* ---------------- 划词 ---------------- */
  // 照 LightRead PdfShow 的做法：
  //   · 定位只在 **mouseup / keyup** 时做（16ms 后再 rAF，等选区落定），
  //     selectionchange 只用来判断"选区没了"就收起工具条 —— 否则拖动过程中每帧重排，工具条会跳；
  //   · mouseup 的坐标交给 pickAnchorRect，多 rect 时锚到离鼠标最近的那一段；
  //   · 点在工具条自己身上不算（否则点按钮的瞬间就被清掉）。
  useEffect(() => {
    setPreview(null)
    setSel(null)
    if (view !== 'pdf' || !paper || captureMode) return
    let previewFrame = 0
    let timer = 0
    let raf = 0
    let pointer: { x: number; y: number } | null = null

    const measure = (cancelEmpty = false) => {
      raf = 0
      const root = viewerRef.current?.scrollElement() ?? null
      const snapshot = readSelection(root, pointer)
      if (!snapshot && cancelEmpty) previewDshQuote(null)
      if (snapshot) pdfSelectionSource.current = `${paper.attachKey}/${paper.file}`
      setPreview(snapshot)
      setSel(snapshot)
    }
    const schedule = (cancelEmpty = false) => {
      if (timer) window.clearTimeout(timer)
      if (raf) cancelAnimationFrame(raf)
      timer = window.setTimeout(() => {
        timer = 0
        raf = requestAnimationFrame(() => measure(cancelEmpty))
      }, 16)
    }
    const onMouseUp = (event: MouseEvent) => {
      if (event.button !== 0) return
      const target = event.target as Element | null
      if (target?.closest?.('.zr-selbar')) return
      const root = viewerRef.current?.scrollElement()
      if (!root || !root.contains(target) || isScrollbarInteraction(event, root)) return
      pointer = { x: event.clientX, y: event.clientY }
      schedule(true)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      // 键盘扩选（Shift+方向键 / Ctrl+A）没有鼠标点，用最后一个 rect 当锚点
      if (!event.shiftKey && !event.ctrlKey && !event.metaKey && event.key !== 'a' && event.key !== 'A') return
      pointer = null
      schedule()
    }
    const onSelectionChange = () => {
      if (previewFrame) cancelAnimationFrame(previewFrame)
      previewFrame = requestAnimationFrame(() => {
        previewFrame = 0
        const snapshot = readSelection(viewerRef.current?.scrollElement() ?? null)
        if (snapshot) { pdfSelectionSource.current = `${paper.attachKey}/${paper.file}`; setPreview(snapshot) }
      })
    }

    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('keyup', onKeyUp)
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      if (previewFrame) cancelAnimationFrame(previewFrame)
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('keyup', onKeyUp)
      document.removeEventListener('selectionchange', onSelectionChange)
      if (timer) window.clearTimeout(timer)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [view, paper, captureMode])

  useEffect(() => { if (!sel) setPreview(null) }, [sel])

  const addMark = useCallback(
    async (kind: MarkKind, color: string) => {
      if (!paper || !sel) return
      const fresh: NoteMark[] = sel.pages.map((pageSel) => ({
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        kind,
        color: color || MARK_COLORS[0],
        page: pageSel.page,
        rects: pageSel.rects,
        text: sel.text,
        createdAt: new Date().toISOString(),
      }))
      setSel(null)
      clearSelection()
      try {
        const result = await addNotes(paper, fresh)
        setMarks(result.marks)
        setActiveMarkId(fresh[0].id)
      } catch (e) {
        say(`保存失败：${(e as Error).message}`)
      }
    },
    [paper, sel, say],
  )

  const translateSelection = useCallback(async () => {
    if (!sel) return
    const anchor = { x: sel.anchor.x, y: sel.anchor.bottom + 12 }
    const snapshot = sel
    setSel(null)
    clearSelection()
    setTranslateCard({ ...anchor, text: '', loading: true })
    try {
      const out = await translateText(snapshot.text, 'zh')
      setTranslateCard({ ...anchor, text: out, loading: false })
    } catch (e) {
      setTranslateCard({ ...anchor, text: `翻译失败：${(e as Error).message}`, loading: false })
    }
  }, [sel])

  const copySelection = useCallback(() => {
    if (!sel) return
    void navigator.clipboard?.writeText(sel.text).catch(() => {})
    setSel(null)
    clearSelection()
    say('已复制')
  }, [sel, say])

  const quoteSelection = useCallback(() => {
    if (!sel || !paper) return
    const ok = sendToDsh({ source: paperSource(paper, variant), title: paper.title, page: sel.pages[0].page, text: sel.text, locations: sel.pages, intent: 'quote' })
    say(ok ? '引用已附加，可输入问题或直接发送解释' : '先打开一个会话')
    setSel(null)
    clearSelection()
  }, [paper, sel, say])

  useEffect(() => {
    if (view !== 'pdf' || captureMode) return
    if (paper && preview?.text && pdfSelectionSource.current === `${paper.attachKey}/${paper.file}`) previewDshQuote({ source: paperSource(paper, variant), title: paper.title, page: preview.pages[0]?.page, text: preview.text, locations: preview.pages, intent: 'quote' })
  }, [paper, view, preview, captureMode, variant])

  useEffect(() => () => previewDshQuote(null), [paper?.attachKey, paper?.file, view])

  useEffect(() => {
    if (view !== 'pdf' || !captureMode) return
    if (paper && capture) previewDshCapture({ source: paperSource(paper, variant), title: paper.title, page: capture.page, locations: capture.locations, text: capture.text, context: capture.context, intent: 'quote' }, capture.image)
    else previewDshQuote(null)
    return () => previewDshQuote(null)
  }, [paper, view, captureMode, capture, variant])

  /* ---------------- 快捷键 ---------------- */
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null
      const typing = !!target && (/^(INPUT|TEXTAREA)$/.test(target.tagName) || target.isContentEditable)

      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'f' && paper && view === 'pdf') {
        ev.preventDefault()
        setFindOpen(true)
        window.setTimeout(() => findInputRef.current?.select(), 0)
        return
      }
      if (ev.key === 'Escape') {
        setQuickOpen(false)
        setCaptureMode(false)
        if (markPop) setMarkPop(null)
        if (translateCard) setTranslateCard(null)
        if (translateOpen) setTranslateOpen(false)
        if (findOpen) {
          setFindOpen(false)
          setFindQuery('')
          setFindHits([])
          viewerRef.current?.clearSearch()
        }
        if (sel) { setSel(null); setPreview(null) }
        previewDshQuote(null)
        return
      }
      if (typing || !paper || view !== 'pdf') return
      if (ev.key === 'j') viewerRef.current?.jumpTo(Math.min(numPages, page + 1))
      else if (ev.key === 'k') viewerRef.current?.jumpTo(Math.max(1, page - 1))
      else if (ev.key === '+' || ev.key === '=') setScale((s) => Math.min(ZOOM_MAX, +(s + ZOOM_STEP).toFixed(2)))
      else if (ev.key === '-') setScale((s) => Math.max(ZOOM_MIN, +(s - ZOOM_STEP).toFixed(2)))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [paper, view, numPages, page, findOpen, sel, markPop, translateCard, translateOpen])

  useEffect(() => {
    const target = pendingTextJump.current
    if (!doc || view !== 'pdf' || !target) return
    pendingTextJump.current = null
    viewerRef.current?.jumpTo(target.page, target.bbox[3] > target.bbox[1] ? target.bbox[1] : undefined)
  }, [doc, view])

  const captureFilename = (page: number) => `${paper?.file.replace(/\.pdf$/i, '') ?? 'PDF'}-p${page}.png`
  const copyCapture = async (item: PdfCapture) => {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': item.image })])
  }
  const askCapture = async (item: PdfCapture) => {
    const image = new File([await item.image], captureFilename(item.page), { type: 'image/png' })
    if (sendCaptureToDsh({ source: paperSource(paper, variant), title: paper?.title, page: item.page, locations: item.locations, text: item.text, context: item.context, intent: 'ask' }, image)) {
      say('截图已附到对话草稿')
    } else {
      try {
        await copyCapture(item)
        say('截图已复制，请在对话输入框按 Ctrl+V 附上')
      } catch {
        say('无法自动附图，请下载截图后添加到对话')
      }
    }
  }
  const downloadCapture = async (item: PdfCapture) => {
    const url = URL.createObjectURL(await item.image)
    const link = document.createElement('a')
    link.href = url
    link.download = captureFilename(item.page)
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1500)
  }

  const url = paper ? pdfUrl(paper, variant) : ''
  const hitCount = findHits.reduce((sum, h) => sum + h.count, 0)
  const notesSorted = useMemo(
    () => [...marks].sort((a, b) => a.page - b.page || a.createdAt.localeCompare(b.createdAt)),
    [marks],
  )

  const jumpTo = useCallback((target: number) => {
    viewerRef.current?.jumpTo(target)
  }, [])

  return (
    <div className="zr-page zr-docked">
      <QuotePreview />
      {/* 顶栏：窄面板里分两行，标题优先拿宽度 */}
      <div className="zr-top">
        <button type="button" className="zr-btn zr-btn-icon" title="打开文献库" aria-label="打开文献库"
          aria-pressed={drawer === 'library'} onClick={revealLibrary}><Icon name="book" /></button>
        <div className="zr-document-picker">
          <span className="zr-pick-title" title={paper?.title}>{paper?.title ?? '选择文献'}</span>
          <button type="button" className="zr-btn zr-btn-icon" title="快速切换文献" aria-label="快速切换文献"
            aria-expanded={quickOpen} onClick={() => { setDrawer(null); setQuickOpen((value) => !value) }}><Icon name="chevronDown" /></button>
          {quickOpen ? (
            <div className="zr-quick-picker">
              <div className="zr-row">
                <strong>切换文献</strong>
                <button className="zr-btn zr-btn-icon" aria-label="关闭文献切换" style={{ marginInlineStart: 'auto' }}
                  onClick={() => setQuickOpen(false)}><Icon name="close" /></button>
              </div>
              {[...(paper ? [paper] : []), ...(library?.papers ?? []).filter((item) => item.attachKey !== paper?.attachKey)].map((item) => (
                <button key={item.attachKey} className="zr-item" aria-current={item.attachKey === paper?.attachKey ? 'true' : undefined}
                  data-active={item.attachKey === paper?.attachKey ? '' : undefined}
                  onClick={() => { if (item.attachKey === paper?.attachKey) setQuickOpen(false); else openPaper(item) }}>
                  <div className="zr-item-t">{item.title}</div>
                  <div className="zr-item-m">{[item.creators?.[0]?.lastName, item.year].filter(Boolean).join(' · ')}</div>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <PaperSummary paper={paper} onNotify={say} />
        {setup ? (
          <button className="zr-btn zr-btn-icon" aria-label="初始化配置" title="初始化配置"
            onClick={() => void getReaderSetup().then((next) => { setSetup(next); setSetupOpen(true) }).catch(() => say('读取初始化配置失败'))}>
            <Icon name="sparkle" />
          </button>
        ) : null}
        <div className="zr-seg">
          <button
            className="zr-seg-btn"
            data-active={view === 'pdf' ? '' : undefined}
            disabled={!paper}
            onClick={() => {
              if (view === 'text' && pdfLocation && !variant) {
                pendingTextJump.current = pdfLocation
                setDoc(null)
              }
              setView('pdf')
            }}
          >
            PDF
          </button>
          <button
            className="zr-seg-btn"
            data-active={view === 'text' ? '' : undefined}
            disabled={!paper}
            onClick={() => { setTextPoint(null); setView('text') }}
          >
            文本
          </button>
        </div>

        <button
          className="zr-btn zr-btn-icon"
          data-active={translateOpen ? '' : undefined}
          title="翻译与 PDF 导出"
          disabled={!paper}
          onClick={() => setTranslateOpen((v) => !v)}
        >
          <Icon name="translate" />
        </button>
      </div>

      {paper && view === 'pdf' ? (
        <div className="zr-toolbar">
          <div className="zr-toolbar-group" role="group" aria-label="翻页">
          <button className="zr-btn zr-btn-icon" title="上一页 (k)" disabled={page <= 1} onClick={() => jumpTo(page - 1)}>
            <Icon name="chevronLeft" />
          </button>
          <span className="zr-page-no-lbl zr-mono">
            {page}/{numPages || '-'}
          </span>
          <button
            className="zr-btn zr-btn-icon"
            title="下一页 (j)"
            disabled={page >= numPages}
            onClick={() => jumpTo(page + 1)}
          >
            <Icon name="chevronRight" />
          </button>

          </div>
          <div className="zr-toolbar-group" role="group" aria-label="缩放">

          <button
            className="zr-btn zr-btn-icon"
            title="缩小 (-)"
            disabled={view !== 'pdf'}
            onClick={() => {
              setAutoFit(false)
              setScale((s) => Math.max(ZOOM_MIN, +(s - ZOOM_STEP).toFixed(2)))
            }}
          >
            <Icon name="minus" />
          </button>
          <span className="zr-page-no-lbl zr-mono" style={{ minWidth: 34, textAlign: 'center' }}>
            {Math.round(scale * 100)}%
          </span>
          <button
            className="zr-btn zr-btn-icon"
            title="放大 (+)"
            disabled={view !== 'pdf'}
            onClick={() => {
              setAutoFit(false)
              setScale((s) => Math.min(ZOOM_MAX, +(s + ZOOM_STEP).toFixed(2)))
            }}
          >
            <Icon name="plus" />
          </button>
          <button
            className="zr-btn zr-fit-control"
            aria-pressed={autoFit}
            title={autoFit ? '已启用适应宽度，窗口变化时自动缩放。点击恢复 100%' : '适应页面宽度'}
            aria-label={autoFit ? '适应宽度已启用' : '适应宽度'}
            disabled={view !== 'pdf'}
            onClick={() => {
              if (autoFit) { setAutoFit(false); setScale(1) }
              else setAutoFit(true)
            }}
          >
            <Icon name="fit" />
            <span>适宽</span>
          </button>

          </div>
          <div className="zr-toolbar-group" role="group" aria-label="阅读工具">

          <button
            className="zr-btn zr-btn-icon"
            data-active={findOpen ? '' : undefined}
            title="搜索 (Ctrl+F)"
            disabled={view !== 'pdf'}
            onClick={() => {
              setFindOpen((v) => !v)
              window.setTimeout(() => findInputRef.current?.focus(), 0)
            }}
          >
            <Icon name="search" />
          </button>

          <button
            className="zr-btn zr-btn-icon"
            title="页面缩略图"
            aria-label="页面缩略图"
            data-active={drawer === 'thumbs' ? '' : undefined}
            onClick={() => { setQuickOpen(false); setDrawer(drawer === 'thumbs' ? null : 'thumbs') }}
          >
            <Icon name="thumbnails" />
          </button>

          <button type="button" className="zr-btn zr-btn-icon"
            title={captureMode ? '当前：截图选中。点击切换到文字选中' : '当前：文字选中。点击切换到截图选中'}
            aria-label="截图选中模式" aria-pressed={captureMode}
            data-active={captureMode ? '' : undefined}
            onClick={() => {
              clearSelection()
              setSel(null)
              setPreview(null)
              setCapture(null)
              setCaptureMode((enabled) => !enabled)
            }}>
            <Icon name={captureMode ? 'capture' : 'textSelect'} />
          </button>

          </div>
          <button
            className="zr-btn zr-btn-icon"
            style={{ marginLeft: 'auto' }}
            title="重新扫描 Zotero"
            onClick={() => void loadLibrary()}
          >
            <Icon name="refresh" />
          </button>
        </div>
      ) : null}

      {/* 搜索条 */}
      {paper && findOpen && view === 'pdf' ? (
        <div className="zr-findbar">
          <Icon name="search" />
          <input
            ref={findInputRef}
            value={findQuery}
            placeholder="全文搜索…"
            onChange={(e) => void runSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') stepSearch(e.shiftKey ? -1 : 1)
            }}
          />
          <span className="zr-find-count">
            {findQuery ? (hitCount ? `${findIndex + 1}/${findHits.length}·${hitCount}处` : '无匹配') : ''}
          </span>
          <button className="zr-btn zr-btn-icon" onClick={() => stepSearch(-1)} title="上一处">
            <Icon name="chevronLeft" />
          </button>
          <button className="zr-btn zr-btn-icon" onClick={() => stepSearch(1)} title="下一处">
            <Icon name="chevronRight" />
          </button>
          <button
            className="zr-btn zr-btn-icon"
            title="关闭"
            onClick={() => {
              setFindOpen(false)
              setFindQuery('')
              setFindHits([])
              viewerRef.current?.clearSearch()
            }}
          >
            <Icon name="close" />
          </button>
        </div>
      ) : null}

      {/* 画布 */}
      <div className="zr-dock-body" ref={bodyRef}>
        {!paper ? (
          <div className="zr-empty">
            <Icon name="book" size={24} />
            <div className="zr-empty-title">
              {libError ? 'Zotero 不可用' : loading ? '读取 Zotero…' : '选一篇文献开始阅读'}
            </div>
            <div style={{ fontSize: 12, maxWidth: 320 }}>
              {libError || (library ? `${library.papers.length} 篇带 PDF，直接读本地库不复制文件` : '')}
            </div>
            {libError ? (
              <button className="zr-btn" onClick={() => void loadLibrary()}>
                <Icon name="refresh" /> 重试
              </button>
            ) : null}
          </div>
        ) : view === 'text' ? (
          <TextViewer
            key={`${paper.attachKey}/${paper.file}`}
            paper={paper}
            initialPage={variant.endsWith('-dual.pdf') ? Math.ceil(page / 2) : page}
            point={textPoint}
            onNotify={say}
            bilingual={bilingual}
            onBilingual={setBilingual}
            onJumpBlock={(pageNo, bbox) => {
              clearSelection()
              pendingTextJump.current = { page: pageNo, bbox }
              setPdfLocation({ page: pageNo, bbox })
              setDoc(null)
              setVariant('')
              setView('pdf')
            }}
          />
        ) : (
          <PdfViewer
            ref={viewerRef}
            url={url}
            scale={scale}
            marks={marks}
            selection={captureMode ? undefined : (preview ?? sel)?.pages}
            captureMode={captureMode}
            onCapture={setCapture}
            location={variant ? null : pdfLocation}
            onJumpText={(pageNo, x, y) => {
              clearSelection()
              setSel(null)
              setPreview(null)
              setMarkPop(null)
              setTextPoint({ page: variant.endsWith('-dual.pdf') ? Math.ceil(pageNo / 2) : pageNo, x, y })
              setView('text')
            }}
            activeMarkId={activeMarkId}
            onSelectMark={(mark, point) => {
              setActiveMarkId(mark.id)
              setMarkPop({ mark, x: point.x, y: point.y })
            }}
            onDoc={(next, pages) => {
              setDoc(next)
              setNumPages(pages)
            }}
            onPageChange={setPage}
            onError={(e) => say(`渲染失败：${e.message}`)}
          />
        )}

        {/* 抽屉：覆盖在画布上，不挤压阅读区 */}
        {drawer ? (
          <div className="zr-drawer">
            <div className="zr-drawer-tabs">
              {DRAWER_TABS.map((t) => (
                <button
                  key={t.id}
                  className="zr-left-tab"
                  data-active={drawer === t.id ? '' : undefined}
                  onClick={() => setDrawer(t.id)}
                >
                  {t.label}
                  {t.id === 'notes' && marks.length ? ` ${marks.length}` : ''}
                </button>
              ))}
              <button className="zr-btn zr-btn-icon" title="收起" onClick={() => setDrawer(null)}>
                <Icon name="close" />
              </button>
            </div>

            {drawer === 'library' ? (
              <>
                <input
                  className="zr-search"
                  placeholder="搜索标题 / 作者 / 年份…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  autoFocus
                />
                <div className="zr-library-upload">
                  <select className="zr-txt-select" aria-label="PDF 导入目标" value={importFolder} onChange={(e) => setImportFolder(e.target.value)}>
                    <option value="">Zotero 当前选中的位置</option>
                    {library?.collections.map((folder) => <option key={folder.collectionID} value={folder.collectionID}>{folder.name}</option>)}
                  </select>
                  <button type="button" className="zr-btn zr-btn-primary" disabled={importingPdf} onClick={() => pdfInput.current?.click()}>
                    <Icon name="upload" />{importingPdf ? '导入中…' : '导入 PDF'}
                  </button>
                  <input ref={pdfInput} type="file" accept=".pdf,application/pdf" hidden onChange={(e) => {
                    const file = e.currentTarget.files?.[0]
                    e.currentTarget.value = ''
                    if (file) void uploadPdf(file)
                  }} />
                </div>
                {importMessage ? <p className="zr-library-status" role="status">{importMessage}</p> : null}
                <div className="zr-list">
                  {loading ? <div className="zr-muted" style={{ padding: 10 }}>读取中…</div> : null}
                  {!loading && !filteredPapers.length && query.trim() ? (
                    <div className="zr-muted" style={{ padding: 10 }}>没有匹配的文献</div>
                  ) : null}
                  <LibraryFolders key={query.trim()} folders={library?.collections ?? []} papers={paper && !query.trim() && !filteredPapers.some((item) => item.attachKey === paper.attachKey)
                      ? [paper, ...filteredPapers] : filteredPapers}
                    searching={!!query.trim()} active={paper?.attachKey} onOpen={openPaper} />
                </div>
              </>
            ) : null}

            {drawer === 'thumbs' ? (
              <Thumbs doc={doc} numPages={numPages} currentPage={page} onJump={jumpTo} />
            ) : null}

            {drawer === 'outline' ? <Outline doc={doc} currentPage={page} onJump={jumpTo} /> : null}

            {drawer === 'notes' ? (
              <div className="zr-notes">
                {paper ? (
                  <div className="zr-row" style={{ justifyContent: 'space-between', padding: '0 2px 4px' }}>
                    <span className="zr-muted" style={{ fontSize: 11 }}>{marks.length} 条</span>
                    <a className="zr-btn" href={notesExportUrl(paper)} download style={{ height: 22 }}>
                      导出 md
                    </a>
                  </div>
                ) : null}
                {paper && notesSorted.length === 0 ? (
                  <div className="zr-muted" style={{ fontSize: 12 }}>
                    还没有笔记：选中文字 → 工具条 → 高亮 / 下划线 / 删除线。
                  </div>
                ) : null}
                {notesSorted.map((mark) => (
                  <div
                    key={mark.id}
                    className="zr-note"
                    data-active={activeMarkId === mark.id ? '' : undefined}
                    onClick={() => {
                      setActiveMarkId(mark.id)
                      jumpTo(mark.page)
                    }}
                  >
                    <div className="zr-note-head">
                      <span className="zr-note-dot" style={{ background: mark.color }} />
                      <span>p.{mark.page}</span>
                      <span>· {KIND_LABEL[mark.kind]}</span>
                      <span className="zr-note-actions">
                        <button
                          className="zr-btn zr-btn-icon"
                          title="删除"
                          onClick={(e) => {
                            e.stopPropagation()
                            if (!paper) return
                            void deleteNote(paper, mark.id)
                              .then((r) => setMarks(r.marks))
                              .catch((err) => say(`删除失败：${(err as Error).message}`))
                          }}
                        >
                          <Icon name="close" />
                        </button>
                      </span>
                    </div>
                    <div className="zr-note-text">{mark.text}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {view === 'pdf' && captureMode && capture ? (
        <CaptureToolbar getAnchor={capture.getAnchor}>
          <div className="zr-selbar-row">
            <button className="zr-selbar-btn" title="解释：直接发送给 AI" aria-label="解释截图" onClick={() => {
              void (async () => {
                try { await explainInDsh({ source: paperSource(paper, variant), title: paper?.title, page: capture.page, locations: capture.locations, text: capture.text, context: capture.context, intent: 'ask' }, new File([await capture.image], captureFilename(capture.page), { type: 'image/png' })); say('解释请求已发送'); setCapture(null) }
                catch (error) { say((error as Error).message) }
              })()
            }}><Icon name="sparkle" /></button>
            <button className="zr-selbar-btn" title="引用截图" aria-label="引用截图"
              onClick={() => void askCapture(capture).catch(() => say('无法读取截图'))}><Icon name="quote" /></button>
            <button className="zr-selbar-btn" title="复制截图" aria-label="复制截图"
              onClick={() => void copyCapture(capture).then(() => say('已复制截图'), () => say('复制失败，可使用下载'))}><Icon name="copy" /></button>
            <button className="zr-selbar-btn" title="下载 PNG" aria-label="下载 PNG"
              onClick={() => void downloadCapture(capture).catch(() => say('截图下载失败'))}><Icon name="download" /></button>
          </div>
        </CaptureToolbar>
      ) : null}

      {/* 划词工具条 */}
      {sel && view === 'pdf' && !captureMode ? (
        <SelectionToolbar
          anchor={sel.anchor}
          getAnchor={() => {
            const root = viewerRef.current?.scrollElement()
            if (!root) return null
            const rects = sel.pages.flatMap(selection => {
              const box = root.querySelector<HTMLElement>(`.zr-page-box[data-page="${selection.page}"]`)
              if (!box) return []
              const basis = (box.querySelector('canvas') ?? box).getBoundingClientRect()
              return selection.rects.map(rect => ({ left: basis.left + rect.x * basis.width, top: basis.top + rect.y * basis.height,
                right: basis.left + (rect.x + rect.w) * basis.width, bottom: basis.top + (rect.y + rect.h) * basis.height }))
            })
            return visibleSelectionAnchor(rects, root.getBoundingClientRect())
          }}
          onExplain={async () => {
            if (!paper) return
            try { await explainInDsh({ source: paperSource(paper, variant), title: paper.title, page: sel.pages[0].page, text: sel.text, locations: sel.pages, intent: 'ask' }); say('解释请求已发送'); setSel(null); clearSelection() }
            catch (error) { say((error as Error).message) }
          }}
          onTranslate={() => void translateSelection()}
          onMark={(kind, color) => void addMark(kind, color)}
          onCopy={copySelection}
          onQuote={quoteSelection}
          onClose={() => setSel(null)}
        />
      ) : null}

      {/* 划词翻译卡片 */}
      {translateCard ? (
        <div
          className="zr-selbar"
          style={{
            left: Math.min(Math.max(8, translateCard.x - 160), window.innerWidth - 328),
            top: Math.min(translateCard.y, window.innerHeight - 200),
            width: 320,
            padding: '8px 10px',
            display: 'block',
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="zr-row" style={{ marginBottom: 6 }}>
            <Icon name="translate" />
            <span className="zr-muted" style={{ fontSize: 11.5 }}>划词翻译</span>
            <button
              className="zr-btn zr-btn-icon"
              style={{ marginLeft: 'auto' }}
              onClick={() => setTranslateCard(null)}
            >
              <Icon name="close" />
            </button>
          </div>
          <div style={{ fontSize: 12.5, lineHeight: 1.6, maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
            {translateCard.loading ? '翻译中…' : translateCard.text}
          </div>
        </div>
      ) : null}

      {/* 高亮浮层 */}
      {markPop ? (
        <MarkPopover
          mark={markPop.mark}
          point={{ x: markPop.x, y: markPop.y }}
          onPatch={(patch) => {
            if (!paper) return
            void updateNote(paper, markPop.mark.id, patch)
              .then((r) => {
                setMarks(r.marks)
                const fresh = r.marks.find((m) => m.id === markPop.mark.id)
                if (fresh) setMarkPop({ ...markPop, mark: fresh })
              })
              .catch((e) => say(`改色失败：${(e as Error).message}`))
          }}
          onDelete={() => {
            if (!paper) return
            void deleteNote(paper, markPop.mark.id)
              .then((r) => {
                setMarks(r.marks)
                setMarkPop(null)
                setActiveMarkId(null)
              })
              .catch((e) => say(`删除失败：${(e as Error).message}`))
          }}
          onAsk={async () => {
            if (!paper) return
            try { await explainInDsh({ source: paperSource(paper, variant), title: paper.title, page: markPop.mark.page, text: markPop.mark.text, locations: [{ page: markPop.mark.page, rects: markPop.mark.rects }], intent: 'ask' }); say('解释请求已发送'); setMarkPop(null) }
            catch (error) { say((error as Error).message) }
          }}
          onClose={() => setMarkPop(null)}
        />
      ) : null}

      {/* 整篇翻译 */}
      {translateOpen && paper ? (
        <TranslateMenu
          paper={paper}
          variant={variant}
          onBilingual={() => {
            setBilingual(true)
            setView('text')
            setTranslateOpen(false)
          }}
          onVariant={(v) => {
            setVariant(v)
            setView('pdf')
          }}
          onClose={() => setTranslateOpen(false)}
          onNotify={say}
        />
      ) : null}

      {setup && setupOpen ? <SetupGuide setup={setup} onClose={() => setSetupOpen(false)} onDone={() => {
        setSetupOpen(false)
        say('已保存阅读器设置')
      }} /> : null}
      {toast ? <div className="zr-toast">{toast}</div> : null}
    </div>
  )
}

function LibraryFolders({ folders, papers, searching, active, onOpen }: {
  folders: NonNullable<Awaited<ReturnType<typeof getZoteroLibrary>>>['collections']
  papers: ZoteroPaper[]
  searching: boolean
  active?: string
  onOpen: (paper: ZoteroPaper) => void
}) {
  const tree = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const selected = tree.current?.querySelector<HTMLElement>('[aria-current="true"]')
    if (!selected) return
    for (let parent = selected.parentElement; parent && parent !== tree.current; parent = parent.parentElement) {
      if (parent instanceof HTMLDetailsElement) parent.open = true
    }
    selected.scrollIntoView({ block: 'nearest' })
  }, [active, folders, papers])
  const paperRow = (paper: ZoteroPaper) => (
    <button key={paper.itemID} className="zr-item" data-active={active === paper.attachKey ? '' : undefined}
      aria-current={active === paper.attachKey ? 'true' : undefined}
      onClick={() => onOpen(paper)} title={paper.title}>
      <Icon name="file" className="zr-library-file-icon" />
      <div className="zr-item-t">{paper.title}</div>
      <div className="zr-item-m">
        {[[paper.creators?.[0]?.lastName, paper.year].filter(Boolean).join(' · '), paper.venue].filter(Boolean).join(' — ')}
        {paper.variants.length ? ' · 有译文' : ''}
      </div>
    </button>
  )
  const root = (parent: number | null): import('react').ReactNode[] => folders
    .filter((folder) => folder.parentID === parent || (parent === null && !folders.some((entry) => entry.collectionID === folder.parentID)))
    .flatMap((folder) => {
      const items = papers.filter((paper) => paper.collectionIDs?.includes(folder.collectionID) ??
        paper.collections.includes(folder.name))
      const children = root(folder.collectionID)
      if (searching && !items.length && !children.length) return []
      return [(
        <details key={folder.collectionID} className="zr-library-folder" open={searching || items.some((paper) => paper.attachKey === active)}>
          <summary><Icon name="chevronRight" className="zr-folder-caret" /><Icon name="folder" /><span>{folder.name}</span><small>{items.length}</small></summary>
          <div className="zr-library-branch">{children}{items.map(paperRow)}</div>
        </details>
      )]
    })
  const unfiled = papers.filter((paper) => !folders.some((folder) => paper.collectionIDs?.includes(folder.collectionID) ??
    paper.collections.includes(folder.name)))
  return (
    <div ref={tree}>
      {root(null)}
      {unfiled.length ? (
        <details className="zr-library-folder" open>
          <summary><Icon name="chevronRight" className="zr-folder-caret" /><Icon name="folder" /><span>未分类</span><small>{unfiled.length}</small></summary>
          <div className="zr-library-branch">{unfiled.map(paperRow)}</div>
        </details>
      ) : null}
    </div>
  )
}

export default ReaderPane
