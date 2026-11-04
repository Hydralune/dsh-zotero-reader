// python.ts — 找到可用的 Python 解释器并跑一次性探针。
// pdf2zh（整篇翻译）和 pdf→md（版面解析）都需要外部 Python，共用这套探测。

import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { managedPython } from './config.ts'

const CANDIDATES = [
  process.env.LR_PYTHON,
  process.env.LR_PDF2ZH_PYTHON,
  managedPython(),
  'D:/papertranslate/PDFMathTranslate/py310/python.exe',
  path.join(os.homedir(), 'papertranslate/PDFMathTranslate/py310/python.exe'),
  'python',
  ...(process.platform === 'win32' ? [] : ['python3']),
].filter(Boolean) as string[]

export function pythonCandidates(): string[] {
  return [...CANDIDATES]
}

export interface ProbeResult {
  ok: boolean
  out: string
}

/** 跑一段 `python -c`，带超时；不抛异常 */
export function probePython(python: string, code: string, timeoutMs = 20000): Promise<ProbeResult> {
  return new Promise((resolve) => {
    let out = ''
    let settled = false
    const child = spawn(python, ['-c', code], { windowsHide: true })
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        child.kill()
      } catch {
        /* 已经退出 */
      }
      resolve({ ok: false, out: 'timeout' })
    }, timeoutMs)

    child.stdout.on('data', (d) => (out += String(d)))
    child.stderr.on('data', (d) => (out += String(d)))
    child.on('error', (e) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok: false, out: e.message })
    })
    child.on('close', (code2) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok: code2 === 0, out: out.trim() })
    })
  })
}

/** 跑一个脚本文件，返回 stdout/stderr/exitCode */
export function runPython(
  python: string,
  args: string[],
  timeoutMs: number,
  options: { signal?: AbortSignal; onOutput?: (text: string) => void } = {},
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean; aborted: boolean }> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    let aborted = false
    const child = spawn(python, args, { windowsHide: true })
    const terminate = () => {
      if (!child.pid) return
      if (process.platform === 'win32') {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        killer.on('error', () => child.kill())
      } else child.kill()
    }
    const abort = () => { aborted = true; terminate() }
    options.signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => { timedOut = true; terminate() }, timeoutMs)
    const finish = (code: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      resolve({ code, stdout, stderr, timedOut, aborted })
    }
    child.on('spawn', () => { if (options.signal?.aborted) abort() })
    child.stdout.on('data', (data) => {
      const text = String(data)
      stdout += text
      options.onOutput?.(text)
    })
    child.stderr.on('data', (data) => {
      const text = String(data)
      stderr = (stderr + text).slice(-200000)
      options.onOutput?.(text)
    })
    child.on('error', (error) => { stderr += error.message; finish(null) })
    child.on('close', finish)
  })
}

const cache = new Map<string, string | null>()

/** 找到第一个满足 `import <module>` 的解释器；结果按模块缓存 */
export async function findPython(module: string): Promise<string | null> {
  const cached = cache.get(module)
  if (cached !== undefined) return cached
  for (const python of CANDIDATES) {
    try {
      if (path.isAbsolute(python)) await fs.access(python)
    } catch {
      continue
    }
    const result = await probePython(python, `import ${module};print(getattr(${module},'__version__','?'))`)
    if (result.ok) {
      cache.set(module, python)
      return python
    }
  }
  return null
}
