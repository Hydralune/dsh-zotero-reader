// TextViewer.tsx — PDF 的文本视图（结构化块，不是「把 md 渲成网页」）。
//
// 用 blocks.json 而不是 full.md 的原因：每个块都带页面号 + 归一化 bbox，
// 所以「点一段 → 跳回 PDF 那一处」是真功能，不是猜。
//
// 公式：PyMuPDF 抽不出版式级 TeX，块里的 $...$ 会交给 KaTeX 渲染；
// 需要高保真公式时走 MinerU 后端（同一份 blocks 契约，留作后续）。
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  addTextMark, getTextMarks, patchTextMark, removeTextMark, type TextAnchor, type TextMark, type MarkKind,
  cancelMineruParse, type MdJob,
  ApiError, getMarkdownBlocks, getMarkdownStatus, importMineruBlocks, markdownFileUrl,
  pdfUrl, startMarkdown, startMineruParse, translateMarkdownPage, translateText, type MdBlock, type MdPage, type MdDocument, type ZoteroPaper,
} from '../api'
import { RichText } from './RichText'
import { Icon } from '../components/Icon'
import { openPdf, type RenderTask } from './pdf'
import { explainInDsh, previewDshQuote, sendToDsh } from '../dshComposer'
import { MediaMenu } from './MediaMenu'
import { TextCapture } from './TextCapture'

import { SelectionToolbar } from './SelectionToolbar'
import { MarkPopover } from './MarkPopover'
import { anchorRange, selectedTextAnchors, textHighlightAPI } from './text-highlights'

/* ---------------- 块 ---------------- */

function MediaCrop({ url, page, block, onJump }: {
  url: string
  page: MdPage
  block: MdBlock
  onJump: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)
  const [left, top, right, bottom] = block.bbox
  const label = block.type === 'table' ? '原文表格' : block.type === 'equation' ? `原文公式 ${block.text}` : '原文插图'

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    delete canvas.dataset.rendered
    let cancelled = false
    let task: RenderTask | undefined
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      observer.disconnect()
      void (async () => {
        const { doc } = await openPdf(url)
        const source = await doc.getPage(page.page)
        if (cancelled) return
        const base = source.getViewport({ scale: 1 })
        const scale = Math.min(3, 1600 / (base.width * (right - left)), 1600 / (base.height * (bottom - top)))
        const viewport = source.getViewport({ scale })
        canvas.width = Math.ceil(viewport.width * (right - left))
        canvas.height = Math.ceil(viewport.height * (bottom - top))
        const context = canvas.getContext('2d')
        if (!context) throw new Error('canvas unavailable')
        task = source.render({ canvas, canvasContext: context, viewport,
          transform: [1, 0, 0, 1, -left * viewport.width, -top * viewport.height] })
        await task.promise
        canvas.dataset.rendered = 'true'
      })().catch(() => { if (!cancelled) setFailed(true) })
    }, { root: canvas.closest('.zr-textscroll'), rootMargin: '240px' })
    observer.observe(canvas)
    return () => { cancelled = true; observer.disconnect(); task?.cancel() }
  }, [url, page.page, left, top, right, bottom])

  if (failed) return <button className="zr-btn" onClick={onJump}>在 PDF 中查看{label}</button>
  return (
    <button type="button" className={`zr-txt-crop${block.type === 'equation' ? ' zr-txt-crop-equation' : ''}`} onDoubleClick={onJump} onClick={(event) => { if (event.detail === 0) onJump() }} aria-label={`在 PDF 中定位${label}`}>
      <canvas ref={canvasRef} role="img" aria-label={label}
        style={{ aspectRatio: `${(right - left) * page.width} / ${(bottom - top) * page.height}` }} />
    </button>
  )
}

function BlockView({ block, onJump, url, page }: {
  block: MdBlock
  onJump: (block: MdBlock) => void
  url: string
  page: MdPage
}) {
  if (block.crop && block.bbox[2] > block.bbox[0] && block.bbox[3] > block.bbox[1]) {
    return <MediaCrop url={url} page={page} block={block} onJump={() => onJump(block)} />
  }
  const common = {
    className: `zr-txt-block zr-txt-${block.type}`,
    title: '双击在原 PDF 中定位',
  }

  if (block.role === 'reference') {
    return <p className="zr-txt-block zr-txt-reference"><RichText text={block.text} /></p>
  }
  if (block.role === 'byline') {
    return <p className="zr-txt-byline"><RichText text={block.text} /></p>
  }
  if (block.type === 'title') {
    const level = block.level ?? 3
    const tag = (`h${Math.min(6, Math.max(2, level + 1))}` as unknown) as 'h2'
    const Tag = tag
    return (
      <Tag className={`zr-txt-block zr-txt-title zr-txt-h${Math.min(4, Math.max(1, level))}`}>
        <RichText text={block.text} />
      </Tag>
    )
  }
  if (block.type === 'figure') {
    return (
      <div {...common} className="zr-txt-block zr-txt-figure">
        <Icon name="thumbnails" /> {block.text || '图（点此在 PDF 里定位）'}
      </div>
    )
  }
  if (block.type === 'table') {
    if (!block.text) return <button className="zr-btn" onClick={() => onJump(block)}>在 PDF 中查看表格</button>
    const rows = block.text.trim().split('\n')
    const cells = (row: string) => row.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim())
    const markdown = rows.length > 1 && rows[0].includes('|') && cells(rows[1]).every((cell) => /^:?-{3,}:?$/.test(cell))
    return (
      <div {...common}>
        {markdown ? (
          <table>
            <thead><tr>{cells(rows[0]).map((cell, i) => <th key={i} scope="col"><RichText text={cell} /></th>)}</tr></thead>
            <tbody>{rows.slice(2).map((row, i) => (
              <tr key={i}>{cells(row).map((cell, j) => <td key={j}><RichText text={cell} /></td>)}</tr>
            ))}</tbody>
          </table>
        ) : <pre>{block.text}</pre>}
      </div>
    )
  }
  if (block.type === 'equation') {
    return <p {...common} className="zr-txt-block zr-txt-equation"><RichText text={block.text} /></p>
  }
  if (block.type === 'list') {
    const lines = block.text.split('\n')
    const ordered = lines.every((line) => /^\d+[.)]\s+/.test(line))
    const List = ordered ? 'ol' : 'ul'
    return (
      <List {...common} start={ordered ? Number(/^\d+/.exec(lines[0])?.[0]) : undefined} className="zr-txt-block zr-txt-list">
        {lines.map((line, i) => (
          <li key={i}><RichText text={line.replace(ordered ? /^\d+[.)]\s+/ : /^[•·◦▪\-–*‣]\s*/, '')} /></li>
        ))}
      </List>
    )
  }
  if (block.type === 'caption') {
    return (
      <div {...common} className="zr-txt-block zr-txt-caption">
        <RichText text={block.text} />
      </div>
    )
  }
  return (
    <p {...common} className="zr-txt-block zr-txt-text">
      <RichText text={block.text} />
    </p>
  )
}

/* ---------------- 主组件 ---------------- */

const TEXT_SCALE_KEY = 'zr-text-font-scale'

function initialTextScale() {
  try {
    const saved = Number(localStorage.getItem(TEXT_SCALE_KEY))
    return saved >= 0.75 && saved <= 1.5 ? Math.round(saved * 100) / 100 : 1
  } catch {
    return 1
  }
}

export function TextViewer({
  paper, initialPage, point, bilingual, onBilingual, onJumpBlock, onNotify,
}: {
  paper: ZoteroPaper
  initialPage: number
  point?: { page: number; x: number; y: number } | null
  onNotify: (message: string) => void
  bilingual: boolean
  onBilingual: (enabled: boolean) => void
  onJumpBlock: (page: number, bbox: [number, number, number, number]) => void
}) {
  const [doc, setDoc] = useState<MdDocument | null>(null)
  const [job, setJob] = useState<{ status: string; stage: string; percent: number; error?: string } | null>(null)
  const [error, setError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [pageNo, setPageNo] = useState(Math.max(1, point?.page ?? initialPage))
  const [section, setSection] = useState('')
  const [textScale, setTextScale] = useState(initialTextScale)
  useEffect(() => {
    try { localStorage.setItem(TEXT_SCALE_KEY, String(textScale)) } catch { /* Reading remains available without storage. */ }
  }, [textScale])
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [located, setLocated] = useState('')
  const locationTimer = useRef(0)
  useEffect(() => () => window.clearTimeout(locationTimer.current), [])
  const [picked, setPicked] = useState<{ text: string; page: number; x: number; y: number; bottom: number; anchors: TextAnchor[] } | null>(null)
  const [captureMode, setCaptureMode] = useState(false)
  const [mediaMenu, setMediaMenu] = useState<{ x: number; y: number; page: number; canvas: HTMLCanvasElement } | null>(null)
  const [textMarks, setTextMarks] = useState<TextMark[]>([])
  const [markPopup, setMarkPopup] = useState<{ mark: TextMark; x: number; y: number } | null>(null)
  const highlightPrefix = useRef(`zrtext-${Math.random().toString(36).slice(2)}`)
  const [translation, setTranslation] = useState<{ text: string; x: number; y: number } | null>(null)
  const selectionTask = useRef(0)
  const [translations, setTranslations] = useState<Record<number, Record<string, string>>>({})
  const [translateError, setTranslateError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [mineruJob, setMineruJob] = useState(false)
  const [mineruStatus, setMineruStatus] = useState<MdJob | null>(null)
  const [engineMenu, setEngineMenu] = useState(false)
  const [hideParseStatus, setHideParseStatus] = useState(false)
  const engineMenuRef = useRef<HTMLDivElement>(null)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')
  const scroll = useRef<HTMLDivElement>(null)
  const initialPosition = useRef(false)
  const pageElements = useRef(new Map<number, HTMLElement>())
  const importer = useRef<HTMLInputElement>(null)
  const pages = doc?.pages ?? []
  const page = pages.find((item) => item.page === pageNo) ?? pages[0]
  const current = page?.page
  const headings = doc?.outline?.length ? doc.outline : pages.flatMap((item) =>
    item.blocks.filter((block) => block.type === 'title' && !block.role &&
      block.text.length <= 115 && !/^[•–-]|^\S+@|,.*?,/.test(block.text))
      .map((block) => ({ page: item.page, title: block.text, level: block.level ?? 1, blockId: block.id })),
  )

  useEffect(() => {
    setPicked(null)
    setMediaMenu(null)
    setCaptureMode(false)
    previewDshQuote(null)
  }, [paper.attachKey, paper.file])

  const readPicked = () => {
    if (captureMode) return
    const selection = window.getSelection()
    if (!selection?.rangeCount || selection.isCollapsed || !scroll.current?.contains(selection.anchorNode) ||
        !scroll.current.contains(selection.focusNode)) {
      setPicked(null)
      return
    }
    const range = selection.getRangeAt(0)
    const anchors = selectedTextAnchors(scroll.current, range)
    const rect = range.getBoundingClientRect()
    const pageElement = range.startContainer.parentElement?.closest<HTMLElement>('[data-text-page]')
    const text = selection.toString().trim()
    if (text && anchors.length) setMarkPopup(null)
    setPicked(text && anchors.length ? { text, page: Number(pageElement?.dataset.textPage) || current || 1,
      x: rect.left + rect.width / 2, y: rect.top, bottom: rect.bottom, anchors } : null)
  }

  useEffect(() => {
    previewDshQuote(picked ? { title: paper.title, page: picked.page, text: picked.text, intent: 'quote' } : null)
    return () => previewDshQuote(null)
  }, [picked, paper])

  useEffect(() => {
    let frame = 0
    const clear = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = 0
        const selection = window.getSelection()
        if (!selection || selection.isCollapsed) { setPicked(null); previewDshQuote(null); return }
        if (captureMode || !scroll.current?.contains(selection.anchorNode) || !scroll.current.contains(selection.focusNode)) return
        const element = selection.anchorNode?.parentElement?.closest<HTMLElement>('[data-text-page]')
        previewDshQuote({ title: paper.title, page: Number(element?.dataset.textPage) || current || 1, text: selection.toString().trim(), intent: 'quote' })
      })
    }
    document.addEventListener('selectionchange', clear)
    return () => { document.removeEventListener('selectionchange', clear); if (frame) cancelAnimationFrame(frame); window.clearTimeout(selectionTask.current) }
  }, [paper, current, captureMode])


  useEffect(() => {
    let alive = true
    let timer: number
    setError('')
    const load = async (start: boolean) => {
      try {
        const next = start ? null : await getMarkdownStatus(paper)
        if (!alive) return
        if (next?.ready) {
          const data = await getMarkdownBlocks(paper)
          if (alive) setDoc(data)
          return
        }
        const status = start ? await startMarkdown(paper) : next?.job
        if (!alive) return
        setJob(status ?? null)
        if (status?.status !== 'error') timer = window.setTimeout(() => void load(false), 1100)
      } catch (e) {
        if (alive) setError((e as Error).message)
      }
    }
    void getMarkdownBlocks(paper).then((data) => { if (alive) setDoc(data) }).catch((e) => {
      if (!alive) return
      if (e instanceof ApiError && e.status === 404) void load(true)
      else setError((e as Error).message)
    })
    return () => { alive = false; window.clearTimeout(timer) }
  }, [paper, loadAttempt])

  useEffect(() => {
    if (!bilingual || !doc || !current) return
    const abort = new AbortController()
    setTranslateError('')
    const fetchPage = async (number: number, prefetch = false) => {
      const result = await translateMarkdownPage(paper, number, abort.signal, prefetch)
      if (!abort.signal.aborted) setTranslations((previous) => ({ ...previous, [number]: result }))
    }
    const timer = window.setTimeout(() => {
      const next = doc.pages.find((item) => item.page === current + 1)?.page
      if (!translations[current]) {
        void fetchPage(current).catch((e) => {
          if (!abort.signal.aborted) setTranslateError((e as Error).message)
        })
      }
      if (next && !translations[next]) void fetchPage(next, true).catch(() => {})
    }, 120)
    return () => { window.clearTimeout(timer); abort.abort() }
    // The local translations cache is updated as each request resolves.
  }, [bilingual, doc, current, paper, attempt])

  useEffect(() => {
    let active = true
    void getTextMarks(paper).then(({ marks }) => { if (active) setTextMarks(marks) })
      .catch((error: Error) => { if (active) onNotify(`读取文本标注失败：${error.message}`) })
    return () => { active = false }
  }, [paper, onNotify])

  useEffect(() => {
    const root = scroll.current
    const api = textHighlightAPI()
    if (!root || !api) return
    const names: string[] = []
    const style = document.createElement('style')
    document.head.append(style)
    let frame = 0
    const paint = () => {
      frame = 0
      for (const name of names) api.registry.delete(name)
      names.length = 0
      const rules: string[] = []
      textMarks.forEach((mark, index) => {
        const ranges = mark.anchors.map((anchor) => anchorRange(root, anchor)).filter((range): range is Range => !!range)
        if (!ranges.length) return
        const name = `${highlightPrefix.current}-${index}`
        names.push(name)
        api.registry.set(name, new api.Highlight(...ranges))
        const color = /^#[0-9a-f]{6}$/i.test(mark.color) ? mark.color : '#ffeb3b'
        const declaration = mark.kind === 'highlight' ? `background-color:${color}66;`
          : `text-decoration: ${mark.kind === 'underline' ? 'underline' : 'line-through'} ${color} 2px;`
        rules.push(`::highlight(${name}){${declaration}}`)
      })
      style.textContent = rules.join('\n')
    }
    paint()
    const observer = new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(paint) })
    observer.observe(root, { childList: true, subtree: true, characterData: true })
    return () => {
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
      for (const name of names) api.registry.delete(name)
      style.remove()
    }
  }, [textMarks, doc])

  const markSelection = async (kind: MarkKind, color: string) => {
    if (!picked) return
    if (!textHighlightAPI()) { onNotify('当前浏览器不支持文本标注，请升级桌面端'); return }
    const mark: TextMark = { id: crypto.randomUUID(), kind, color, page: picked.page,
      text: picked.text, anchors: picked.anchors, createdAt: new Date().toISOString() }
    setPicked(null)
    window.getSelection()?.removeAllRanges()
    try { setTextMarks((await addTextMark(paper, mark)).marks) }
    catch (error) { onNotify(`保存文本标注失败：${(error as Error).message}`) }
  }
  const askSelected = (intent: 'ask' | 'quote') => {
    if (!picked) return
    const sent = sendToDsh({ title: paper.title, page: picked.page, text: picked.text, intent })
    onNotify(sent ? '引用已附加，可输入问题或直接发送解释' : '无法附加引用，请先打开会话')
    setPicked(null)
    window.getSelection()?.removeAllRanges()
  }

  const changePage = (number: number, heading = '', key = heading) => {
    setPageNo(number)
    setSection(key)
    const target = (heading ? document.getElementById(`zr-block-${heading}`) : null) ?? pageElements.current.get(number)
    target?.scrollIntoView({ block: 'start' })
  }

  useEffect(() => {
    if (!doc || initialPosition.current) return
    initialPosition.current = true
    const targetPage = doc.pages.find((entry) => entry.page === pageNo)
    let best: MdBlock | undefined
    let distance = Infinity
    if (point && targetPage) {
      for (const block of targetPage.blocks) {
        const [left, top, right, bottom] = block.bbox
        if (right <= left || bottom <= top) continue
        const dx = Math.max(left - point.x, point.x - right, 0)
        const dy = Math.max(top - point.y, point.y - bottom, 0)
        const score = dx * dx + dy * dy + Math.abs((top + bottom) / 2 - point.y) * 0.0001
        if (score < distance) { distance = score; best = block }
      }
    }
    if (best) {
      setLocated(best.id)
      window.clearTimeout(locationTimer.current)
      locationTimer.current = window.setTimeout(() => setLocated(''), 500)
    }
    const element = (best ? document.getElementById(`zr-block-${best.id}`) : null) ?? pageElements.current.get(pageNo)
    element?.scrollIntoView({ block: 'start' })
  }, [doc, pageNo, point])

  useEffect(() => {
    const root = scroll.current
    if (!root || !doc) return
    let frame = 0
    const update = () => {
      frame = 0
      const threshold = root.getBoundingClientRect().top + Math.min(120, root.clientHeight * 0.25)
      let active = doc.pages[0]?.page
      for (const item of doc.pages) {
        const el = pageElements.current.get(item.page)
        if (!el || el.getBoundingClientRect().top > threshold) break
        active = item.page
      }
      if (active !== undefined) setPageNo(active)
    }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update) }
    root.addEventListener('scroll', onScroll, { passive: true })
    return () => { root.removeEventListener('scroll', onScroll); if (frame) cancelAnimationFrame(frame) }
  }, [doc])

  useEffect(() => {
    let alive = true
    void getMarkdownStatus(paper).then(({ job }) => {
      if (alive && job?.status === 'running' && job.stage.includes('MinerU')) {
        setMineruStatus(job); setMineruJob(true)
      }
    }).catch(() => {})
    return () => { alive = false }
  }, [paper])

  useEffect(() => {
    if (!engineMenu) return
    const close = (event: PointerEvent) => {
      if (!engineMenuRef.current?.contains(event.target as Node)) setEngineMenu(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [engineMenu])

  useEffect(() => {
    if (!mineruJob) return
    let alive = true
    let timer: number
    const poll = async () => {
      try {
        const { job: status } = await getMarkdownStatus(paper)
        if (!alive) return
        setMineruStatus(status)
        if (status?.status === 'running') {
          timer = window.setTimeout(() => void poll(), 1500)
          return
        }
        if (status?.status === 'error') throw new Error(status.error || 'MinerU 解析失败')
        if (status?.status === 'cancelled') { setMineruJob(false); return }
        const parsed = await getMarkdownBlocks(paper)
        if (!alive) return
        setTranslations({})
        setDoc(parsed)
        setMineruJob(false)
      } catch (error) {
        if (alive) { setImportError((error as Error).message); setMineruJob(false) }
      }
    }
    timer = window.setTimeout(() => void poll(), 750)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [mineruJob, paper])

  const parseWithMineru = async (wholeDocument = false) => {
    setImportError('')
    setHideParseStatus(false)
    setEngineMenu(false)
    setMineruJob(true)
    try { setMineruStatus(await startMineruParse(paper, wholeDocument ? undefined : current)) }
    catch (error) { setImportError((error as Error).message); setMineruJob(false) }
  }
  const cancelParsing = async () => {
    try { await cancelMineruParse(paper) }
    catch (error) { setImportError((error as Error).message) }
  }
  const showQuickText = async () => {
    setEngineMenu(false)
    try {
      const native = await getMarkdownBlocks(paper, 'native')
      setTranslations({})
      setDoc(native)
    } catch (error) { setImportError((error as Error).message) }
  }
  const showMineruText = async () => {
    setEngineMenu(false)
    setImportError('')
    try {
      // The default document is the persisted, merged MinerU result when present.
      // Switching readers must not launch a new parse or overwrite this cache.
      const enhanced = await getMarkdownBlocks(paper)
      if (enhanced.source === 'mineru') {
        setTranslations({})
        setDoc(enhanced)
      } else {
        await parseWithMineru(true)
      }
    } catch (error) { setImportError((error as Error).message) }
  }
  const loadMineru = async (file: File) => {
    setImportError('')
    setImporting(true)
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error('MinerU JSON 超过 8 MB')
      const next = await importMineruBlocks(paper, JSON.parse(await file.text()))
      setTranslations({})
      setSection('')
      setDoc(next)
    } catch (e) {
      setImportError((e as Error).message)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="zr-textwrap" style={{ '--zr-text-scale': textScale } as CSSProperties}>
      <div className="zr-textbar">
        <span className="zr-txt-source" title={page?.source === 'pymupdf' || doc?.source !== 'mineru'
          ? '快速原文，PyMuPDF 解析' : 'MinerU 增强结果'}>
          {!doc ? '文本阅读' : page?.source === 'pymupdf' || doc.source !== 'mineru' ? 'PyMuPDF'
            : `MinerU ${(page?.parser ?? doc.parser)?.tier ?? ''}`}
        </span>
        {doc ? (
          <button type="button" className="zr-btn zr-btn-icon" title={outlineOpen ? '收起目录' : '展开目录'} aria-label={outlineOpen ? '收起目录' : '展开目录'} aria-expanded={outlineOpen} aria-controls="zr-text-outline"
            onClick={() => setOutlineOpen((open) => !open)}>
            <Icon name="outline" />
          </button>
        ) : null}
        <div className="zr-txt-pages">
          <button className="zr-btn zr-btn-icon" aria-label="上一页" disabled={!current || current <= 1} onClick={() => changePage((current ?? 1) - 1)}><Icon name="chevronLeft" /></button>
          <select className="zr-txt-select" aria-label="跳至页码" value={current ?? ''} onChange={(e) => changePage(Number(e.target.value))}>
            {pages.map((entry) => <option key={entry.page} value={entry.page}>{entry.page} / {doc?.pageCount}</option>)}
          </select>
          <button className="zr-btn zr-btn-icon" aria-label="下一页" disabled={!current || current >= (doc?.pageCount ?? 0)} onClick={() => changePage((current ?? 1) + 1)}><Icon name="chevronRight" /></button>
        </div>
        <div className="zr-text-size" role="group" aria-label="文本字号">
          <button className="zr-btn zr-btn-icon" title="缩小文本字号" aria-label="缩小文本字号"
            disabled={textScale <= 0.75} onClick={() => setTextScale((value) => Math.max(0.75, Math.round((value - 0.05) * 100) / 100))}>
            <Icon name="minus" />
          </button>
          <button className="zr-btn zr-text-size-value" title="恢复默认字号" aria-label="恢复默认字号"
            onClick={() => setTextScale(1)}>{Math.round(textScale * 100)}%</button>
          <button className="zr-btn zr-btn-icon" title="放大文本字号" aria-label="放大文本字号"
            disabled={textScale >= 1.5} onClick={() => setTextScale((value) => Math.min(1.5, Math.round((value + 0.05) * 100) / 100))}>
            <Icon name="plus" />
          </button>
        </div>
        <div className="zr-txt-actions">
          <button className="zr-btn zr-btn-icon" aria-label="文本截图选中模式" aria-pressed={captureMode}
            title={captureMode ? '切换为文字选中' : '切换为截图选中'} data-active={captureMode ? '' : undefined}
            onClick={() => { setPicked(null); window.getSelection()?.removeAllRanges(); setCaptureMode(value => !value) }}>
            <Icon name={captureMode ? 'capture' : 'textSelect'} />
          </button>
          <button className="zr-btn zr-btn-icon" title="中英对照" aria-label="中英对照" aria-pressed={bilingual}
            data-active={bilingual ? '' : undefined} onClick={() => onBilingual(!bilingual)}><Icon name="translate" /></button>
          <div className="zr-engine-control" ref={engineMenuRef}>
            <button className="zr-btn zr-btn-icon" title={mineruJob ? '查看解析进度' : '切换 PyMuPDF / MinerU，或重新解析'}
              aria-label="解析方式" aria-expanded={engineMenu} aria-busy={mineruJob} disabled={!doc || importing}
              onClick={() => setEngineMenu((open) => !open)}><Icon name="scanDocument" /></button>
            {engineMenu ? (
              <div className="zr-engine-menu" onKeyDown={(event) => {
                if (event.key === 'Escape') { event.stopPropagation(); setEngineMenu(false) }
              }}>
                <div className="zr-row"><strong>解析方式</strong><button className="zr-btn zr-btn-icon"
                  style={{ marginInlineStart: 'auto' }} aria-label="关闭解析菜单" onClick={() => setEngineMenu(false)}><Icon name="close" /></button></div>
                <button className="zr-btn" onClick={() => void showQuickText()}><Icon name="text" />快速原文 · PyMuPDF</button>
                <button className="zr-btn" onClick={() => void showMineruText()} title="优先打开已保存的增强全文；没有结果时才开始解析"><Icon name="file" />MinerU · 打开增强全文</button>
                <button className="zr-btn" disabled={mineruJob} onClick={() => void parseWithMineru()}><Icon name="scanDocument" />重新解析当前页 · 第 {current} 页</button>
                <button className="zr-btn" disabled={mineruJob} onClick={() => void parseWithMineru(true)}><Icon name="scanDocument" />重新解析整篇 · {doc?.pageCount} 页</button>
                {mineruJob ? <div className="zr-engine-progress" role="status">
                  <span>{mineruStatus?.stage ?? '准备解析'} · {Math.round(mineruStatus?.percent ?? 0)}%</span>
                  <button className="zr-btn" onClick={() => void cancelParsing()}>取消解析</button>
                </div> : null}
              </div>
            ) : null}
          </div>
          <button className="zr-btn zr-btn-icon" title="导入 MinerU JSON" aria-label="导入 MinerU JSON"
            disabled={!doc || importing || mineruJob} onClick={() => importer.current?.click()}><Icon name="upload" /></button>
          <input type="file" accept=".json,application/json" hidden ref={importer} onChange={(e) => {
            const file = e.currentTarget.files?.[0]
            e.currentTarget.value = ''
            if (file) void loadMineru(file)
          }} />
          {doc ? <a className="zr-btn zr-btn-icon" title="导出 Markdown" aria-label="导出 Markdown" href={markdownFileUrl(paper)} download><Icon name="download" /></a> : null}
        </div>
      </div>
      {((mineruJob && !hideParseStatus) || importError) ? (
        <div className="zr-parse-status" role="status">
          <span>{importError || `${mineruStatus?.stage ?? '准备解析'} · ${Math.round(mineruStatus?.percent ?? 0)}%`}</span>
          {mineruJob ? <button className="zr-btn" onClick={() => void cancelParsing()}>取消解析</button> : null}
          <button className="zr-btn zr-btn-icon" aria-label="隐藏解析提示" title="隐藏提示，继续阅读"
            onClick={() => { setHideParseStatus(true); setImportError('') }}><Icon name="close" /></button>
        </div>
      ) : null}
      <div className="zr-txt-layout" data-outline-hidden={!doc || !outlineOpen ? '' : undefined}>
        {doc ? (
          <nav id="zr-text-outline" className="zr-txt-outline" aria-label="章节目录" hidden={!outlineOpen}>
            <div className="zr-txt-outline-label">章节目录</div>
            {!headings.length ? <div className="zr-muted">未识别到标题</div> : null}
            {headings.map(({ page: target, title, level, blockId }, index) => {
              const key = `${target}-${index}`
              return (
                <button key={key} type="button" title={title}
                  style={{ paddingInlineStart: 10 + 12 * (Math.min(4, level) - 1) }}
                  aria-current={section === key ? 'location' : undefined}
                  onClick={() => changePage(target, blockId ?? '', key)}>
                  <span>{title}</span><small>{target}</small>
                </button>
              )
            })}
          </nav>
        ) : null}
        <div className="zr-textscroll" ref={scroll}
          onContextMenu={event => {
            const canvas = (event.target as Element).closest('.zr-txt-crop')?.querySelector('canvas')
            if (!canvas || !canvas.width || canvas.dataset.rendered !== 'true') return
            event.preventDefault(); event.stopPropagation()
            setPicked(null)
            setMediaMenu({ x: event.clientX, y: event.clientY, canvas, page: Number(canvas.closest<HTMLElement>('[data-text-page]')?.dataset.textPage) || current || 1 })
          }}
          onScroll={() => { setPicked(null); setMarkPopup(null) }}
          onClick={(event) => {
            if (!window.getSelection()?.isCollapsed) return
            const target = event.target as HTMLElement
            const run = target.closest<HTMLElement>('[data-text-block]')
            if (!run) { setMarkPopup(null); return }
            const hit = [...textMarks].reverse().find((mark) => mark.anchors.some((anchor) => {
              if (anchor.block !== run.dataset.textBlock || anchor.side !== run.dataset.textSide || !scroll.current) return false
              const range = anchorRange(scroll.current, anchor)
              return range && [...range.getClientRects()].some((r) =>
                event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom)
            }))
            setMarkPopup(hit ? { mark: hit, x: event.clientX, y: event.clientY } : null)
          }}
          onMouseUp={() => { window.clearTimeout(selectionTask.current); selectionTask.current = window.setTimeout(readPicked, 0) }}
          onKeyUp={(event) => {
            if (event.key === 'Escape') { setPicked(null); setTranslation(null); setMarkPopup(null); return }
            if (event.shiftKey || event.ctrlKey || event.metaKey) readPicked()
          }}>
          {!doc ? (
            <div className="zr-empty">
              <div className="zr-empty-title">{error || job?.status === 'error' ? '文本解析失败' : '正在解析版面…'}</div>
              <span>{error || job?.error || job?.stage || '正在准备文本'}</span>
              {error || job?.status === 'error' ? <button className="zr-btn" onClick={() => setLoadAttempt((n) => n + 1)}>重试</button> : null}
            </div>
          ) : null}
          {pages.map((page) => (
            <article key={page.page} data-text-page={page.page} className="zr-txt-page" ref={(element) => {
              if (element) pageElements.current.set(page.page, element)
              else pageElements.current.delete(page.page)
            }}>
              <div className="zr-txt-page-no">第 {page.page} 页 <span>{doc?.title || paper.title}</span></div>
              {bilingual && page.page === current && !translations[page.page] ? (
                <div className="zr-txt-status" role="status">
                  {translateError || '正在翻译本页，原文可先阅读。'}
                  {translateError ? <button className="zr-btn" onClick={() => { setTranslateError(''); setAttempt((n) => n + 1) }}>重试本页</button> : null}
                </div>
              ) : null}
              {!page.blocks.length ? <p className="zr-muted">本页没有可显示的文本。</p> : null}
              {page.blocks.map((block) => {
                const translated = bilingual ? translations[page.page]?.[block.id] : undefined
                return (
                  <div className="zr-txt-pair" key={block.id} id={`zr-block-${block.id}`}
                    data-located={located === block.id ? '' : undefined}
                    data-role={block.role}
                    onDoubleClick={(event) => {
                      if (event.target instanceof Element && event.target.closest('button')) return
                      event.preventDefault()
                      window.clearTimeout(selectionTask.current)
                      setPicked(null)
                      onJumpBlock(page.page, block.bbox)
                    }}>
                    <div data-text-block={block.id} data-text-side="original">
                      <BlockView block={block} url={pdfUrl(paper)} page={page} onJump={() => onJumpBlock(page.page, block.bbox)} />
                    </div>
                    {translated ? <div data-text-block={block.id} data-text-side="translation" className="zr-txt-translation" lang="zh-Hans"><RichText text={translated} /></div> : null}
                  </div>
                )
              })}
            </article>
          ))}
        </div>
      </div>
      {captureMode ? <TextCapture root={scroll} paper={paper} onNotify={onNotify} /> : null}
      {mediaMenu ? <MediaMenu {...mediaMenu} paper={paper} onClose={() => setMediaMenu(null)} onNotify={onNotify} /> : null}
      {picked && !captureMode ? (
        <SelectionToolbar anchor={{ x: picked.x, y: picked.y, bottom: picked.bottom }}
          onExplain={async () => {
            try { await explainInDsh({ title: paper.title, page: picked.page, text: picked.text, intent: 'ask' }); setPicked(null); window.getSelection()?.removeAllRanges(); onNotify('解释请求已发送') }
            catch (error) { onNotify((error as Error).message) }
          }}
          onQuote={() => askSelected('quote')}
          onMark={(kind, color) => void markSelection(kind, color)}
          onClose={() => setPicked(null)}
          onCopy={() => {
            void navigator.clipboard.writeText(picked.text).then(() => onNotify('已复制')).catch(() => onNotify('复制失败'))
            setPicked(null)
            window.getSelection()?.removeAllRanges()
          }}
          onTranslate={() => {
            const position = { x: Math.max(8, picked.x - 142), y: Math.max(8, picked.y - 42) }
            setTranslation({ ...position, text: '翻译中…' })
            setPicked(null)
            window.getSelection()?.removeAllRanges()
            void translateText(picked.text, /[\u3400-\u9fff]/.test(picked.text) ? 'en' : 'zh').then(
              (text) => setTranslation((card) => card?.x === position.x && card.y === position.y ? { ...position, text } : card),
              (error: Error) => setTranslation((card) => card?.x === position.x && card.y === position.y ? { ...position, text: error.message } : card),
            )
          }} />
      ) : null}
      {markPopup ? (
        <MarkPopover mark={{ ...markPopup.mark, rects: [] }} point={{ x: markPopup.x, y: markPopup.y }}
          onClose={() => setMarkPopup(null)}
          onAsk={async () => {
            try { await explainInDsh({ title: paper.title, page: markPopup.mark.page, text: markPopup.mark.text, intent: 'ask' }); onNotify('解释请求已发送'); setMarkPopup(null) }
            catch (error) { onNotify((error as Error).message) }
          }}
          onPatch={(patch) => {
            void patchTextMark(paper, markPopup.mark.id, patch).then(({ marks }) => {
              setTextMarks(marks)
              const updated = marks.find((mark) => mark.id === markPopup.mark.id)
              setMarkPopup(updated ? { ...markPopup, mark: updated } : null)
            }).catch((error: Error) => onNotify(error.message))
          }}
          onDelete={() => {
            void removeTextMark(paper, markPopup.mark.id).then(({ marks }) => {
              setTextMarks(marks); setMarkPopup(null)
            }).catch((error: Error) => { setMarkPopup(null); onNotify(error.message) })
          }} />
      ) : null}
      {translation ? (
        <div className="zr-selbar zr-text-result" style={{ left: Math.min(translation.x, Math.max(8, window.innerWidth - 336)), top: Math.min(translation.y, window.innerHeight - 180) }}>
          <div>{translation.text}</div>
          <button className="zr-btn zr-btn-icon" aria-label="关闭翻译" onClick={() => setTranslation(null)}><Icon name="close" /></button>
        </div>
      ) : null}
    </div>
  )
}

export default TextViewer
