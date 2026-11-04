// config.ts — 插件自己的落盘位置。
// 全部放在 <DSH_HOME>/.dsh-lr-reader/ 下：不进用户 Zotero 库，也不进文献库目录。

import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export function dshHome(): string {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

/** <DSH_HOME>/.dsh-lr-reader */
export function configDir(): string {
  return path.join(dshHome(), '.dsh-lr-reader')
}

export function managedPython() {
  return path.join(configDir(), 'env', ...(process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python']))
}

/** 高亮与笔记：一篇文章一份 json，按 Zotero 附件 key 命名 */
export function notesDir(): string {
  return path.join(configDir(), 'notes')
}

/* ------------------------------------------------------------------ */
/* 整篇翻译（pdf2zh 子进程）的端点                                      */
/* ------------------------------------------------------------------ */

/**
 * pdf2zh 是独立的 Python 进程，只能吃 OpenAI 兼容端点（baseURL/key/model）。
 * DSH 的模型通道（ctx.llm）是进程内调用，导不给它 —— 所以这一项是唯一需要单独填的凭据，
 * 且只在「整篇翻译」用到。留空时接口会明确告诉用户去填，不会假装可用。
 */
export interface Pdf2zhEndpoint {
  baseURL: string
  apiKey: string
  model: string
}

export function pdf2zhConfigPath(): string {
  return path.join(configDir(), 'pdf2zh.json')
}

export async function readPdf2zhEndpoint(): Promise<Pdf2zhEndpoint | null> {
  try {
    const raw = JSON.parse(await fs.readFile(pdf2zhConfigPath(), 'utf8')) as Partial<Pdf2zhEndpoint>
    if (!raw.baseURL || !raw.model) return null
    return { baseURL: String(raw.baseURL), apiKey: String(raw.apiKey ?? ''), model: String(raw.model) }
  } catch {
    return null
  }
}

export async function savePdf2zhEndpoint(next: Pdf2zhEndpoint): Promise<void> {
  const dir = configDir()
  await fs.mkdir(dir, { recursive: true })
  const target = pdf2zhConfigPath()
  const tmp = `${target}.tmp-${process.pid}`
  await fs.writeFile(tmp, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 })
  await fs.rename(tmp, target)
  try {
    await fs.chmod(target, 0o600)
  } catch {
    /* Windows 上可能无效 */
  }
}

/** 打码回显，绝不回明文 */
export function maskKey(key: string): string {
  if (!key) return ''
  if (key.length <= 8) return '••••'
  return `${key.slice(0, 4)}••••${key.slice(-4)}`
}
