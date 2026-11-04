import { normalizeReferences } from './references.ts'
// markdown.ts — PDF → 结构化文本（Markdown + 块索引），靠本地 PyMuPDF。
//
// 为什么要 blocks.json 而不只是 md：文本视图要能**点块回跳 PDF**，
// 所以每个块都带页面号与归一化 bbox。md 只用于导出/复制。
//
// 缓存：<DSH_HOME>/.dsh-lr-reader/md/<attachKey>__<stem>/{blocks.json,full.md}

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { detectMineru, readSetup, type ReaderSetup } from './setup.ts'
import { importMineru } from './mineru.ts'
import { configDir } from './config.ts'
import { findPython, runPython } from './python.ts'

export interface MdBlock {
  id: string
  type: 'title' | 'text' | 'list' | 'table' | 'figure' | 'caption' | 'equation'
  level?: number
  /** 归一化 bbox：[x0, y0, x1, y1]，0..1 */
  bbox: [number, number, number, number]
  text: string
  markdown?: string
  crop?: boolean
  role?: 'document-title' | 'byline' | 'reference'
}

export interface MdPage {
  page: number
  width: number
  height: number
  blocks: MdBlock[]
  source?: 'pymupdf' | 'mineru'
  parser?: MdDocument['parser']
}

export interface MdDocument {
  source?: 'mineru'
  parser?: { version: string; tier: NonNullable<ReaderSetup['mineruTier']> }
  version: number
  title: string
  pageCount: number
  pages: MdPage[]
  outline?: Array<{ title: string; level: number; page: number; blockId?: string | null }>
}

export interface MdJob {
  key: string
  status: 'running' | 'done' | 'error' | 'cancelled'
  stage: string
  percent: number
  error?: string
  pages?: number
  blocks?: number
  startedAt: number
  finishedAt?: number
  targetPage?: number
}

const mineruControllers = new Map<string, AbortController>()
const jobs = new Map<string, MdJob>()

export function mdKey(attachKey: string, file: string): string {
  return `${attachKey}__${path.basename(file).replace(/\.pdf$/i, '')}`
}

export function mdDir(attachKey: string, file: string): string {
  return path.join(configDir(), 'md', mdKey(attachKey, file))
}

export function getMdJob(key: string): MdJob | undefined {
  return jobs.get(key)
}

const scriptPath = () => fileURLToPath(new URL('../scripts/pdf-to-md.py', import.meta.url))

export async function readNativeMdDocument(attachKey: string, file: string): Promise<MdDocument | null> {
  try {
    const raw = await fs.readFile(path.join(mdDir(attachKey, file), 'blocks.json'), 'utf8')
    const doc = JSON.parse(raw) as MdDocument
    return doc.version >= 6 ? normalizeReferences(doc) : null
  } catch {
    return null
  }
}

/** 缓存命中则直接返回 */
export async function readMdDocument(attachKey: string, file: string): Promise<MdDocument | null> {
  try {
    const dir = mdDir(attachKey, file)
    const raw = await fs.readFile(path.join(dir, 'mineru.json'), 'utf8').catch((error) => {
      if (error.code !== 'ENOENT') throw error
      return fs.readFile(path.join(dir, 'blocks.json'), 'utf8')
    })
    const doc = JSON.parse(raw) as MdDocument
    return doc.source === 'mineru' || doc.version >= 6 ? normalizeReferences(doc) : null
  } catch {
    return null
  }
}

export async function saveMineruDocument(attachKey: string, file: string, doc: MdDocument) {
  const target = path.join(mdDir(attachKey, file), 'mineru.json')
  const tmp = `${target}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(tmp, JSON.stringify(doc), 'utf8')
    await fs.rename(tmp, target)
  } finally {
    await fs.rm(tmp, { force: true })
  }
}

export function startMineru(options: { attachKey: string; file: string; pdfPath: string; page?: number }, base: MdDocument): MdJob {
  const key = mdKey(options.attachKey, options.file)
  const existing = jobs.get(key)
  if (existing?.status === 'running') return existing
  const controller = new AbortController()
  mineruControllers.set(key, controller)
  const job: MdJob = { key, status: 'running', stage: '启动 MinerU', percent: 5, startedAt: Date.now(), targetPage: options.page }
  jobs.set(key, job)
  void (async () => {
    const dir = mdDir(options.attachKey, options.file)
    const temp = path.join(dir, `mineru-${randomUUID()}.tmp`)
    try {
      const engine = await detectMineru()
      if (controller.signal.aborted) return
      if (!engine) throw new Error('未检测到 MinerU 4.1+，请打开初始化指导配置本地环境')
      const tier = (await readSetup()).mineruTier ?? 'standard'
      job.stage = `MinerU ${engine.version} · ${tier}${options.page ? ` · 第 ${options.page} 页` : ' · 整篇'}`
      job.percent = 20
      const script = fileURLToPath(new URL('../scripts/mineru-to-content.py', import.meta.url))
      const previous = await readMdDocument(options.attachKey, options.file) ?? base
      const args = [script, options.pdfPath, temp, tier]
      if (options.page) args.push(String(options.page))
      const result = await runPython(engine.python, args, 30 * 60_000, {
        signal: controller.signal,
        onOutput: (text) => {
          const progress = [...text.matchAll(/(\d{1,3})%/g)].at(-1)?.[1]
          if (progress) job.percent = Math.min(95, Math.max(job.percent, 20 + Number(progress) * 0.7))
        },
      })
      if (result.aborted || controller.signal.aborted) return
      if (result.timedOut) throw new Error('MinerU 解析超时')
      if (result.code !== 0) {
        const lines = (result.stderr || result.stdout).replace(/\x1b\[[0-9;]*m/g, '').trim().split(/\r?\n/)
        const message = lines.findLast((line) => /^\w*(?:Error|Exception):/.test(line.trim())) ?? lines.at(-1)
        throw new Error(message?.trim().slice(0, 300) || 'MinerU 解析失败')
      }
      const parsed = importMineru(JSON.parse(await fs.readFile(temp, 'utf8')), base)
      const parser = { version: engine.version, tier }
      const pages = parsed.pages.map((page, index) => {
        if (options.page && page.page !== options.page) {
          const retained = previous.pages[index] ?? base.pages[index] ?? page
          return { ...retained, source: retained.source ?? (previous.source === 'mineru' ? 'mineru' as const : 'pymupdf' as const), parser: retained.parser ?? previous.parser }
        }
        return page.blocks.length ? { ...page, source: 'mineru' as const, parser }
          : { ...(base.pages[index] ?? page), source: 'pymupdf' as const, parser: undefined }
      })
      const outline = parsed.outline?.map((entry) => ({ ...entry,
        blockId: pages[entry.page - 1]?.blocks.find((block) => block.type === 'title' &&
          block.text.trim().toLowerCase() === entry.title.trim().toLowerCase())?.id,
      }))
      if (controller.signal.aborted) return
      await saveMineruDocument(options.attachKey, options.file, { ...parsed, pages, parser, outline })
      Object.assign(job, { status: 'done', stage: '完成', percent: 100, pages: parsed.pageCount })
    } catch (error) {
      if (!controller.signal.aborted) Object.assign(job, { status: 'error', stage: 'MinerU 解析失败', error: (error as Error).message })
    } finally {
      if (controller.signal.aborted) Object.assign(job, { status: 'cancelled', stage: '已取消', error: undefined })
      if (mineruControllers.get(key) === controller) mineruControllers.delete(key)
      job.finishedAt = Date.now()
      await fs.rm(temp, { force: true }).catch(() => {})
    }
  })()
  return job
}

export function cancelMineru(key: string) {
  const controller = mineruControllers.get(key)
  controller?.abort()
  return jobs.get(key)
}

export async function readMdMarkdown(attachKey: string, file: string): Promise<string | null> {
  try {
    const doc = await readMdDocument(attachKey, file)
    if (doc) {
      return doc.pages.flatMap((page) => page.blocks.map((b) =>
        b.type === 'title' ? `${'#'.repeat(b.level ?? 1)} ${b.text}` : b.text,
      )).join('\n\n')
    }
    return await fs.readFile(path.join(mdDir(attachKey, file), 'full.md'), 'utf8')
  } catch {
    return null
  }
}

export async function hasMd(attachKey: string, file: string): Promise<boolean> {
  return (await readMdDocument(attachKey, file)) !== null
}

/**
 * 起一次解析任务。已就绪直接返回 done；进行中返回既有任务，不重复跑。
 */
export async function startMarkdown(options: {
  attachKey: string
  file: string
  pdfPath: string
  title?: string
}): Promise<MdJob> {
  const key = mdKey(options.attachKey, options.file)
  const existing = jobs.get(key)
  if (existing?.status === 'running') return existing
  if (await hasMd(options.attachKey, options.file)) {
    const done: MdJob = {
      key,
      status: 'done',
      stage: '已解析',
      percent: 100,
      startedAt: existing?.startedAt ?? Date.now(),
      finishedAt: Date.now(),
    }
    jobs.set(key, done)
    return done
  }

  const job: MdJob = { key, status: 'running', stage: '启动解析器', percent: 5, startedAt: Date.now() }
  jobs.set(key, job)

  void (async () => {
    try {
      const python = await findPython('fitz')
      if (!python) {
        job.status = 'error'
        job.stage = '缺少解析器'
        job.error = `没找到带 PyMuPDF 的 Python：设置 LR_PYTHON 指向一个能 import fitz 的解释器`
        job.finishedAt = Date.now()
        return
      }

      const outDir = mdDir(options.attachKey, options.file)
      await fs.mkdir(outDir, { recursive: true })
      job.stage = '解析版面'
      job.percent = 35

      const result = await runPython(
        python,
        [scriptPath(), options.pdfPath, outDir, options.title ?? ''],
        180_000,
      )
      if (result.timedOut) {
        job.status = 'error'
        job.stage = '超时'
        job.error = '解析超时（>180s）'
        job.finishedAt = Date.now()
        return
      }
      if (result.code !== 0) {
        job.status = 'error'
        job.stage = '解析失败'
        job.error = (result.stderr || result.stdout || '未知错误').trim().slice(0, 500)
        job.finishedAt = Date.now()
        return
      }

      let parsed: { pages?: number; blocks?: number } = {}
      try {
        parsed = JSON.parse(result.stdout.trim().split('\n').pop() ?? '{}') as typeof parsed
      } catch {
        /* 输出不是 JSON 也不致命，文件在就行 */
      }
      const doc = await readMdDocument(options.attachKey, options.file)
      if (!doc) {
        job.status = 'error'
        job.stage = '解析失败'
        job.error = '解析器没有产出 blocks.json'
        job.finishedAt = Date.now()
        return
      }
      job.status = 'done'
      job.stage = '完成'
      job.percent = 100
      job.pages = parsed.pages ?? doc.pageCount
      job.blocks = parsed.blocks
      job.finishedAt = Date.now()
    } catch (error) {
      job.status = 'error'
      job.stage = '失败'
      job.error = error instanceof Error ? error.message : String(error)
      job.finishedAt = Date.now()
    }
  })()

  return job
}
