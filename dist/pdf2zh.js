// pdf2zh.ts — 全文翻译（PDFMathTranslate / pdf2zh）。
//
// 为什么用 pdf2zh 而不是自己调 LLM：它按版式重排 PDF —— 公式、图、表格位置原地保留，
// 只替换文字层，产出「纯中文(-mono)」与「中英对照(-dual)」两个版本。自己拼 LLM 做不到。
//
// 引擎探测顺序：
//   1. 环境变量 LR_PDF2ZH_PYTHON（显式指定 python 解释器）
//   2. 便携版 D:/papertranslate/PDFMathTranslate/py310/python.exe
//   3. PATH 上的 python（要求能 import pdf2zh）
//
// 凭据只经环境变量传给子进程，不落命令行（避免出现在进程列表里）。
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { managedPython } from "./config.js";
const jobs = new Map();
export function getJob(key) {
    return jobs.get(key);
}
const CANDIDATES = [
    process.env.LR_PDF2ZH_PYTHON,
    managedPython(),
    'D:/papertranslate/PDFMathTranslate/py310/python.exe',
    path.join(os.homedir(), 'papertranslate/PDFMathTranslate/py310/python.exe'),
    'python',
].filter(Boolean);
let engineCache;
function runProbe(python, code, timeoutMs = 20000) {
    return new Promise((resolve) => {
        let out = '';
        const child = spawn(python, ['-c', code], { windowsHide: true });
        const timer = setTimeout(() => {
            try {
                child.kill();
            }
            catch { }
            resolve({ ok: false, out: 'timeout' });
        }, timeoutMs);
        child.stdout.on('data', (d) => (out += String(d)));
        child.stderr.on('data', (d) => (out += String(d)));
        child.on('error', (e) => {
            clearTimeout(timer);
            resolve({ ok: false, out: e.message });
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            resolve({ ok: code === 0, out: out.trim() });
        });
    });
}
/** 探测可用的 pdf2zh 引擎；结果在进程内缓存 */
export async function locateEngine() {
    if (engineCache !== undefined)
        return engineCache;
    for (const python of CANDIDATES) {
        try {
            if (python !== 'python')
                await fs.access(python);
        }
        catch {
            continue;
        }
        const r = await runProbe(python, "import pdf2zh;from pdf2zh.pdf2zh import main;print(getattr(pdf2zh,'__version__','?'))");
        if (r.ok) {
            engineCache = { python, version: r.out.split('\n').pop() || '?' };
            console.log(`[dsh-zotero-reader] pdf2zh ${engineCache.version} @ ${python}`);
            return engineCache;
        }
        console.warn('[dsh-zotero-reader] pdf2zh probe failed for', python, r.out.slice(0, 200));
    }
    return null;
}
/** 把用户在模型设置里存的端点变成 pdf2zh 需要的环境变量 */
function translatorEnv(ep) {
    return {
        OPENAI_BASE_URL: ep.baseURL,
        OPENAI_API_KEY: ep.apiKey,
        OPENAI_MODEL: ep.model,
    };
}
/** 启动整篇导出。进行中的任务按附件去重。 */
export async function startTranslate(opts) {
    const existing = jobs.get(opts.key);
    if (existing?.status === 'running')
        return existing;
    const job = {
        key: opts.key,
        status: 'running',
        stage: '准备中',
        percent: 2,
        startedAt: Date.now(),
    };
    jobs.set(opts.key, job);
    const engine = await locateEngine();
    if (!engine) {
        job.status = 'error';
        job.error = '未找到 pdf2zh 引擎（需要 PDFMathTranslate 的 python 环境）';
        job.finishedAt = Date.now();
        return job;
    }
    let staging;
    try {
        staging = await fs.mkdtemp(path.join(opts.outDir, '.zr-translate-'));
    }
    catch (error) {
        job.status = 'error';
        job.stage = '失败';
        job.error = error.message;
        job.finishedAt = Date.now();
        return job;
    }
    const env = { ...process.env, ...translatorEnv(opts.endpoint), PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
    const argv = [
        '-s', 'openai',
        '-li', opts.langIn || 'en',
        '-lo', opts.langOut || 'zh',
        '-o', staging,
        '-t', String(opts.threads ?? 4),
        opts.pdfPath,
    ];
    job.stage = '启动引擎';
    job.percent = 5;
    const launcher = fileURLToPath(new URL('../scripts/run-pdf2zh.py', import.meta.url));
    const child = spawn(engine.python, [launcher, ...argv], { env, windowsHide: true });
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
    }, 30 * 60_000);
    let stderrTail = '';
    const onData = (buf) => {
        const text = buf.toString('utf8');
        // pdf2zh 的进度行形如 "[12%] translate ..."，抓百分比与阶段名
        const m = /(\d{1,3})%/.exec(text);
        if (m) {
            const p = Math.min(99, Math.max(job.percent, Number(m[1])));
            job.percent = p;
        }
        const stage = /(parse|detect|translate|typeset|save|Generate|Loading)/i.exec(text);
        if (stage)
            job.stage = stage[1];
        stderrTail = (stderrTail + text).slice(-3000);
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', (error) => { stderrTail = error.message; });
    child.on('close', async (code) => {
        clearTimeout(timer);
        try {
            if (timedOut)
                throw new Error('PDF 导出超过 30 分钟');
            if (code !== 0) {
                const detail = opts.endpoint.apiKey ? stderrTail.split(opts.endpoint.apiKey).join('••••') : stderrTail;
                const status = [...detail.matchAll(/(?:Error code:|HTTP\/\d(?:\.\d)?["']?\s+)\s*(\d{3})/g)].at(-1)?.[1];
                throw new Error(status
                    ? `翻译端点 HTTP ${status}，请检查模型、额度或密钥`
                    : `pdf2zh 退出码 ${code ?? '?'}：${detail.trim().split('\n').at(-1)?.slice(0, 220) || '无输出'}`);
            }
            const mono = path.join(staging, `${opts.stem}-mono.pdf`);
            const dual = path.join(staging, `${opts.stem}-dual.pdf`);
            await Promise.all([mono, dual].map(async (file) => {
                const handle = await fs.open(file, 'r');
                try {
                    const { buffer } = await handle.read(Buffer.alloc(5), 0, 5, 0);
                    if (buffer.toString() !== '%PDF-')
                        throw new Error('导出文件不是有效 PDF');
                }
                finally {
                    await handle.close();
                }
            }));
            const zhPath = path.join(opts.outDir, `${opts.stem}-zh.pdf`);
            const dualPath = path.join(opts.outDir, `${opts.stem}-dual.pdf`);
            await fs.rename(mono, zhPath);
            await fs.rename(dual, dualPath);
            job.mono = zhPath;
            job.dual = dualPath;
            job.status = 'done';
            job.stage = '完成';
            job.percent = 100;
        }
        catch (error) {
            job.status = 'error';
            job.stage = '失败';
            job.error = error.message;
        }
        finally {
            job.finishedAt = Date.now();
            await Promise.all(['mono', 'dual'].map((kind) => fs.rm(path.join(staging, `${opts.stem}-${kind}.pdf`), { force: true }).catch(() => { })));
            await fs.rmdir(staging).catch(() => { });
        }
    });
    return job;
}
