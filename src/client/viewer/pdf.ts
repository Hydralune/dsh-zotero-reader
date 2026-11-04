// pdf.ts — pdf.js 装载与文档句柄。
//
// 只有一处 import：插件自己的 /lr-reader/vendor/pdf.min.mjs（不经 DSH 的打包器，
// 也不再有 iframe）。worker 同目录，只启动一次，整个页面生命周期复用。
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  PDFDocumentLoadingTask,
  RenderTask,
} from 'pdfjs-dist'

export const PDFJS_URL = '/lr-reader/vendor/pdf.min.mjs'
export const WORKER_URL = '/lr-reader/vendor/pdf.worker.min.mjs'

type PdfjsModule = {
  GlobalWorkerOptions: { workerSrc: string }
  getDocument(params: { url: string; cMapUrl?: string; cMapPacked?: boolean }): PDFDocumentLoadingTask
  TextLayer: new (options: Record<string, unknown>) => {
    render(): Promise<void>
    textDivs: HTMLElement[]
  }
}

let modPromise: Promise<PdfjsModule> | null = null

/** 动态加载 pdf.js（只加载一次） */
export function loadPdfjs(): Promise<PdfjsModule> {
  if (!modPromise) {
    modPromise = import(/* @vite-ignore */ PDFJS_URL).then((m: unknown) => {
      const mod = ((m as { default?: PdfjsModule }).default ?? m) as PdfjsModule
      mod.GlobalWorkerOptions.workerSrc = WORKER_URL
      return mod
    })
  }
  return modPromise
}

export interface OpenResult {
  doc: PDFDocumentProxy
  pdfjs: PdfjsModule
}

/** 打开一份 PDF；同一 URL 复用进行中的加载 */
const opening = new Map<string, Promise<OpenResult>>()
const tasks = new Map<string, PDFDocumentLoadingTask>()

export function openPdf(url: string): Promise<OpenResult> {
  const cached = opening.get(url)
  if (cached) return cached
  const task = loadPdfjs().then(async (pdfjs) => {
    const loadingTask = pdfjs.getDocument({ url, cMapUrl: '/lr-reader/vendor/', cMapPacked: true })
    tasks.set(url, loadingTask)
    const doc = await loadingTask.promise
    return { doc, pdfjs }
  })
  opening.set(url, task)
  task.catch(() => opening.delete(url))
  return task
}

/** 销毁文档与其 worker 上的缓存（切文献时调用） */
export async function closePdf(url: string): Promise<void> {
  opening.delete(url)
  const task = tasks.get(url)
  tasks.delete(url)
  if (!task) return
  try {
    await task.destroy()
  } catch {
    /* 已经销毁 */
  }
}

export type { PDFDocumentProxy, PDFPageProxy, RenderTask }
