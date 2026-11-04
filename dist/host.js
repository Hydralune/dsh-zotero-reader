import { readTextMarks, changeTextMarks } from "./text-marks.js";
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findImportedPdf, listCollections, listItems, primaryPdf, ZoteroError } from "./zotero.js";
import { NotesError, addMarks, readMarks, removeMark, toMarkdown, updateMark, } from "./notes.js";
import { LlmUnavailable, translate } from "./llm.js";
import { effectiveEndpoint, translatePage } from "./page-translation.js";
import { importMineru } from "./mineru.js";
import { randomUUID } from 'node:crypto';
import { claimReaderWelcome, defaultZoteroDir, detectMineru, readSetup, writeSetup } from "./setup.js";
import { findPython } from "./python.js";
import { maskKey, pdf2zhConfigPath, readPdf2zhEndpoint, savePdf2zhEndpoint, } from "./config.js";
import { getJob, locateEngine, startTranslate } from "./pdf2zh.js";
import { getMdJob, hasMd, mdKey, mdDir, readMdDocument, readNativeMdDocument, readMdMarkdown, startMarkdown, startMineru, cancelMineru, saveMineruDocument, } from "./markdown.js";
class HttpError extends Error {
    code;
    status;
    constructor(code, status, message) {
        super(message);
        this.code = code;
        this.status = status;
        this.name = 'HttpError';
    }
}
function json(res, status, body) {
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
    });
    res.end(JSON.stringify(body));
}
async function readBody(req, limit = 8 * 1024 * 1024) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buf.length;
        if (size > limit)
            throw new HttpError('too-large', 413, '请求体过大');
        chunks.push(buf);
    }
    return Buffer.concat(chunks);
}
async function readJsonBody(req) {
    const buf = await readBody(req);
    if (!buf.length)
        return {};
    try {
        return JSON.parse(buf.toString('utf8'));
    }
    catch {
        throw new HttpError('bad-json', 400, '请求体不是合法 JSON');
    }
}
/** 文件流式响应，支持 Range（pdf.js 按块取） */
async function serveFile(req, res, file, contentType) {
    let st;
    try {
        st = await fs.stat(file);
    }
    catch {
        json(res, 404, { error: '文件不存在' });
        return;
    }
    const range = req.headers.range;
    if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        if (m) {
            const start = m[1] ? parseInt(m[1], 10) : 0;
            const end = m[2] ? parseInt(m[2], 10) : st.size - 1;
            if (start >= st.size || end >= st.size || start > end) {
                res.writeHead(416, { 'content-range': `bytes */${st.size}` });
                res.end();
                return;
            }
            res.writeHead(206, {
                'content-type': contentType,
                'content-length': end - start + 1,
                'content-range': `bytes ${start}-${end}/${st.size}`,
                'accept-ranges': 'bytes',
                'cache-control': 'no-cache',
            });
            createReadStream(file, { start, end }).pipe(res);
            return;
        }
    }
    res.writeHead(200, {
        'content-type': contentType,
        'content-length': st.size,
        'accept-ranges': 'bytes',
        'cache-control': 'no-cache',
    });
    createReadStream(file).pipe(res);
}
const ATTACH_KEY = /^[A-Z0-9]{8}$/i;
function assertKey(value) {
    const key = (value ?? '').trim();
    if (!ATTACH_KEY.test(key))
        throw new HttpError('bad-key', 400, '非法附件 key');
    return key;
}
/** 只取 base name：附件文件名不许带路径 */
function assertFile(value) {
    const name = path.basename((value ?? '').trim());
    if (!name || name === '.' || name === '..')
        throw new HttpError('bad-file', 400, '缺少文件名');
    return name;
}
export function registerRoutes(ctx, config = {}) {
    const ws = ctx.webServer;
    const connection = ctx.connection;
    const zoteroDir = config.zoteroDir?.trim() || defaultZoteroDir();
    const attachPath = (key, file) => {
        const abs = path.join(zoteroDir, 'storage', key, file);
        const rel = path.relative(zoteroDir, abs);
        if (rel.startsWith('..') || path.isAbsolute(rel))
            throw new HttpError('bad-path', 400, '越界路径');
        return abs;
    };
    async function dispatch(req, res, url) {
        const sub = url.pathname.replace(/^\/lr-reader/, '').replace(/\/+$/, '') || '/';
        /* ---------------- Zotero（只读） ---------------- */
        if (sub === '/api/setup' && req.method === 'GET') {
            const settings = await readSetup();
            const endpoint = await readPdf2zhEndpoint();
            json(res, 200, {
                ...settings,
                zoteroDir,
                endpointPath: pdf2zhConfigPath(),
                endpoint: endpoint ? { baseURL: endpoint.baseURL, model: endpoint.model, hasKey: !!endpoint.apiKey } : null,
                guide: await fs.readFile(fileURLToPath(new URL('../SETUP-AGENT.md', import.meta.url)), 'utf8'),
            });
            return;
        }
        if (sub === '/api/setup/welcome' && req.method === 'POST') {
            json(res, 200, { show: await claimReaderWelcome() });
            return;
        }
        if (sub === '/api/setup/check' && req.method === 'GET') {
            const [zotero, python, mineru, pdf2zh] = await Promise.all([
                Promise.all(['zotero.sqlite', 'storage'].map((file) => fs.access(path.join(zoteroDir, file))))
                    .then(() => true, () => false),
                findPython('fitz'), detectMineru(), locateEngine(),
            ]);
            json(res, 200, { zotero, pymupdf: !!python, mineru: mineru?.version ?? null, pdf2zh: !!pdf2zh });
            return;
        }
        if (sub === '/api/setup' && req.method === 'POST') {
            const body = await readJsonBody(req);
            if (body.translation !== undefined && body.translation !== 'dsh' && body.translation !== 'endpoint') {
                throw new HttpError('bad-setup', 400, '不支持的翻译模式');
            }
            const tier = body.mineruTier ?? 'standard';
            if (!['flash', 'basic', 'standard', 'advanced'].includes(tier))
                throw new HttpError('bad-setup', 400, '不支持的解析档位');
            if (body.translation === 'endpoint') {
                const previous = await readPdf2zhEndpoint();
                const endpoint = body.endpoint;
                if (!endpoint && !previous)
                    throw new HttpError('bad-setup', 400, '请填写翻译端点');
                if (endpoint) {
                    const baseURL = (endpoint.baseURL ?? '').trim().replace(/\/+$/, '');
                    const model = (endpoint.model ?? '').trim();
                    let parsed;
                    try {
                        parsed = new URL(baseURL);
                    }
                    catch {
                        throw new HttpError('bad-setup', 400, 'Base URL 无效');
                    }
                    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || !model) {
                        throw new HttpError('bad-setup', 400, '请填写有效的 Base URL 和模型');
                    }
                    await savePdf2zhEndpoint({ baseURL, model,
                        apiKey: endpoint.apiKey?.trim() || (previous?.baseURL === baseURL ? previous.apiKey : ''),
                    });
                }
            }
            const previous = await readSetup();
            await writeSetup({ ...previous, completed: true, translation: body.translation ?? previous.translation, mineruTier: tier });
            json(res, 200, { ok: true });
            return;
        }
        if (sub === '/api/zotero/collections' && req.method === 'GET') {
            json(res, 200, { zoteroDir, collections: await listCollections(zoteroDir) });
            return;
        }
        if (sub === '/api/zotero/library' && req.method === 'GET') {
            const collections = await listCollections(zoteroDir);
            const items = await listItems(zoteroDir, { limit: 3000 });
            const papers = [];
            for (const item of items) {
                const attachment = primaryPdf(item);
                if (!attachment?.filePath)
                    continue;
                const dir = path.join(zoteroDir, 'storage', attachment.key);
                const stem = attachment.filename.replace(/\.pdf$/i, '');
                let variants = [];
                try {
                    const files = await fs.readdir(dir);
                    variants = files.filter((f) => f.startsWith(`${stem}-`) && f.endsWith('.pdf'));
                }
                catch {
                    /* 目录读不到就当没有译文 */
                }
                papers.push({
                    itemID: item.itemID,
                    key: item.key,
                    title: item.title,
                    creators: item.creators,
                    year: item.year,
                    doi: item.doi,
                    venue: item.venue,
                    collections: item.collections,
                    collectionIDs: item.collectionIDs,
                    attachKey: attachment.key,
                    file: attachment.filename,
                    filePath: attachment.filePath,
                    variants,
                });
            }
            json(res, 200, { zoteroDir, collections, papers, total: papers.length });
            return;
        }
        if (sub === '/api/zotero/import' && req.method === 'POST') {
            const filename = assertFile(url.searchParams.get('name'));
            if (!filename.toLowerCase().endsWith('.pdf'))
                throw new HttpError('bad-pdf', 400, '请选择 PDF 文件');
            const folder = url.searchParams.get('collection');
            const collectionID = folder ? Number(folder) : undefined;
            if (collectionID !== undefined && !(await listCollections(zoteroDir)).some((c) => c.collectionID === collectionID)) {
                throw new HttpError('bad-collection', 400, 'Zotero 文件夹不存在');
            }
            const pdf = await readBody(req, 100 * 1024 * 1024);
            if (!pdf.subarray(0, 1024).includes('%PDF-'))
                throw new HttpError('bad-pdf', 400, '文件内容不是 PDF');
            const sessionID = randomUUID();
            const sourceUrl = `http://127.0.0.1/dsh-pdf-import/${sessionID}/${encodeURIComponent(filename)}`;
            const connector = 'http://127.0.0.1:23119/connector/';
            const connectorHeaders = { 'X-Zotero-Connector-API-Version': '3' };
            let saved;
            try {
                saved = await fetch(connector + 'saveStandaloneAttachment', {
                    method: 'POST',
                    headers: {
                        ...connectorHeaders, 'content-type': 'application/pdf',
                        'X-Metadata': JSON.stringify({ sessionID, url: sourceUrl, title: filename.replace(/\.pdf$/i, '') })
                            .replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`),
                    },
                    body: new Uint8Array(pdf.buffer, pdf.byteOffset, pdf.byteLength),
                    signal: AbortSignal.timeout(45_000),
                });
            }
            catch {
                throw new HttpError('zotero-connector', 503, '无法连接 Zotero 桌面端，请打开 Zotero 后再导入');
            }
            if (saved.status !== 201) {
                throw new HttpError('zotero-import', 502, `Zotero 导入失败（HTTP ${saved.status}），请检查当前库是否允许添加附件`);
            }
            let warning = '';
            if (collectionID !== undefined) {
                try {
                    const moved = await fetch(connector + 'updateSession', {
                        method: 'POST', headers: { ...connectorHeaders, 'content-type': 'application/json' },
                        body: JSON.stringify({ sessionID, target: `C${collectionID}` }), signal: AbortSignal.timeout(10_000),
                    });
                    if (!moved.ok)
                        warning = '已存入 Zotero，目标文件夹设置失败';
                }
                catch {
                    warning = '已存入 Zotero，目标文件夹设置失败';
                }
            }
            for (let attempt = 0; attempt < 8; attempt++) {
                const imported = await findImportedPdf(zoteroDir, sourceUrl).catch(() => null);
                if (imported) {
                    await startMarkdown({ ...imported, title: filename.replace(/\.pdf$/i, '') });
                    json(res, 201, { attachKey: imported.attachKey, warning });
                    return;
                }
                await new Promise((resolve) => setTimeout(resolve, 250));
            }
            json(res, 201, { warning: 'Zotero 已保存 PDF，当前库尚未读到该附件，请核对 Zotero 数据目录后刷新文献库' });
            return;
        }
        if (sub === '/api/zotero/file' && req.method === 'GET') {
            const key = assertKey(url.searchParams.get('key'));
            const file = assertFile(url.searchParams.get('file'));
            await serveFile(req, res, attachPath(key, file), 'application/pdf');
            return;
        }
        /* ---------------- 高亮与笔记 ---------------- */
        if (sub === '/api/text-notes') {
            const key = assertKey(url.searchParams.get('key'));
            const file = assertFile(url.searchParams.get('file'));
            if (req.method === 'GET')
                json(res, 200, { marks: await readTextMarks(key, file) });
            else if (req.method === 'POST') {
                const body = await readJsonBody(req);
                if (!body.mark)
                    throw new HttpError('bad-request', 400, '缺少文本标注');
                json(res, 200, { marks: await changeTextMarks(key, file, { add: body.mark }) });
            }
            else if (req.method === 'PATCH') {
                const body = await readJsonBody(req);
                if (!body.patch)
                    throw new HttpError('bad-request', 400, '缺少标注变更');
                json(res, 200, { marks: await changeTextMarks(key, file, { id: body.id, patch: body.patch }) });
            }
            else if (req.method === 'DELETE') {
                json(res, 200, { marks: await changeTextMarks(key, file, { id: url.searchParams.get('id') ?? '' }) });
            }
            else
                throw new HttpError('method', 405, '不支持的请求');
            return;
        }
        if (sub === '/api/notes' && req.method === 'GET') {
            const key = assertKey(url.searchParams.get('key'));
            const file = assertFile(url.searchParams.get('file'));
            json(res, 200, { marks: await readMarks(key, file) });
            return;
        }
        if (sub === '/api/notes' && req.method === 'POST') {
            const key = assertKey(url.searchParams.get('key'));
            const file = assertFile(url.searchParams.get('file'));
            const body = await readJsonBody(req);
            if (!Array.isArray(body.marks) || body.marks.length === 0) {
                throw new HttpError('bad-request', 400, '缺少 marks');
            }
            json(res, 200, { marks: await addMarks(key, file, body.marks) });
            return;
        }
        if (sub === '/api/notes' && req.method === 'DELETE') {
            const key = assertKey(url.searchParams.get('key'));
            const file = assertFile(url.searchParams.get('file'));
            const id = (url.searchParams.get('id') ?? '').trim();
            if (!id)
                throw new HttpError('bad-request', 400, '缺少 id');
            json(res, 200, { marks: await removeMark(key, file, id) });
            return;
        }
        if (sub === '/api/notes' && req.method === 'PATCH') {
            const key = assertKey(url.searchParams.get('key'));
            const file = assertFile(url.searchParams.get('file'));
            const body = await readJsonBody(req);
            const id = (body.id ?? '').trim();
            if (!id)
                throw new HttpError('bad-request', 400, '缺少 id');
            json(res, 200, { marks: await updateMark(key, file, id, { color: body.color, kind: body.kind }) });
            return;
        }
        if (sub === '/api/notes/export' && req.method === 'GET') {
            const key = assertKey(url.searchParams.get('key'));
            const file = assertFile(url.searchParams.get('file'));
            const title = (url.searchParams.get('title') ?? file.replace(/\.pdf$/i, '')).slice(0, 200);
            const marks = await readMarks(key, file);
            const md = toMarkdown(title, marks);
            res.writeHead(200, {
                'content-type': 'text/markdown; charset=utf-8',
                'content-disposition': `attachment; filename="${encodeURIComponent(title)}.md"`,
                'cache-control': 'no-store',
            });
            res.end(md);
            return;
        }
        if (sub === '/api/translate' && req.method === 'POST') {
            const body = await readJsonBody(req);
            const text = (body.text ?? '').trim();
            if (!text)
                throw new HttpError('bad-request', 400, '缺少 text');
            const out = await translate(ctx, text.slice(0, 12000), body.to === 'en' ? 'en' : 'zh');
            json(res, 200, { text: out });
            return;
        }
        /* ---------------- 整篇翻译（pdf2zh 子进程） ---------------- */
        if (sub === '/api/pdf2zh/config' && req.method === 'GET') {
            const current = await readPdf2zhEndpoint();
            json(res, 200, {
                configured: !!current,
                baseURL: current?.baseURL ?? '',
                model: current ? effectiveEndpoint(current).model : '',
                keyMask: maskKey(current?.apiKey ?? ''),
            });
            return;
        }
        if (sub === '/api/pdf2zh/config' && req.method === 'POST') {
            const body = await readJsonBody(req);
            const baseURL = (body.baseURL ?? '').trim().replace(/\/+$/, '');
            const model = (body.model ?? '').trim();
            if (!baseURL || !model)
                throw new HttpError('bad-request', 400, '需要 baseURL 与 model');
            const previous = await readPdf2zhEndpoint();
            await savePdf2zhEndpoint({
                baseURL,
                model,
                apiKey: (body.apiKey ?? '').trim() || (baseURL === previous?.baseURL ? previous.apiKey : ''),
            });
            json(res, 200, { ok: true });
            return;
        }
        if (sub === '/api/zotero/translate/status' && req.method === 'GET') {
            const key = assertKey(url.searchParams.get('key'));
            const file = assertFile(url.searchParams.get('file'));
            const stem = file.replace(/\.pdf$/i, '');
            const job = getJob(`zotero:${key}/${stem}`);
            let variants = [];
            try {
                const files = await fs.readdir(path.join(zoteroDir, 'storage', key));
                variants = files.filter((f) => f.startsWith(`${stem}-`) && f.endsWith('.pdf'));
            }
            catch {
                /* 目录读不到 */
            }
            json(res, 200, { job: job ?? null, variants });
            return;
        }
        if (sub === '/api/zotero/translate' && req.method === 'POST') {
            const body = await readJsonBody(req);
            const key = assertKey(body.attachKey ?? null);
            const file = assertFile(body.file ?? null);
            const abs = attachPath(key, file);
            try {
                await fs.access(abs);
            }
            catch {
                throw new HttpError('not-found', 404, '找不到该 PDF');
            }
            const endpoint = await readPdf2zhEndpoint();
            if (!endpoint) {
                throw new HttpError('pdf2zh-unconfigured', 409, '整篇翻译需要一个 OpenAI 兼容端点：请先在阅读器右上角「设置」里填 Base URL / Key / Model');
            }
            const stem = file.replace(/\.pdf$/i, '');
            const job = await startTranslate({
                key: `zotero:${key}/${stem}`,
                pdfPath: abs,
                outDir: path.join(zoteroDir, 'storage', key),
                stem,
                endpoint: effectiveEndpoint(endpoint),
            });
            json(res, 200, job);
            return;
        }
        if (sub === '/api/engine' && req.method === 'GET') {
            const engine = await locateEngine();
            json(res, 200, engine ? { available: true, ...engine } : { available: false });
            return;
        }
        /* ---------------- 文本视图（PDF → Markdown + 块索引） ---------------- */
        if (sub === '/api/markdown' && req.method === 'GET') {
            const key = assertKey(url.searchParams.get('key'));
            const file = assertFile(url.searchParams.get('file'));
            const job = getMdJob(mdKey(key, file)) ?? null;
            json(res, 200, { job, ready: await hasMd(key, file) });
            return;
        }
        if (sub === '/api/markdown' && req.method === 'POST') {
            const body = await readJsonBody(req);
            const key = assertKey(body.attachKey ?? null);
            const file = assertFile(body.file ?? null);
            const abs = attachPath(key, file);
            try {
                await fs.access(abs);
            }
            catch {
                throw new HttpError('not-found', 404, '找不到该 PDF');
            }
            json(res, 200, await startMarkdown({ attachKey: key, file, pdfPath: abs, title: body.title?.slice(0, 200) }));
            return;
        }
        if (sub === '/api/markdown/blocks' && req.method === 'GET') {
            const key = assertKey(url.searchParams.get('key'));
            const file = assertFile(url.searchParams.get('file'));
            const doc = url.searchParams.get('source') === 'native' ? await readNativeMdDocument(key, file) : await readMdDocument(key, file);
            if (!doc)
                throw new HttpError('not-ready', 404, '文本视图还没生成');
            json(res, 200, doc);
            return;
        }
        if (sub === '/api/markdown/mineru/cancel' && req.method === 'POST') {
            const key = assertKey(url.searchParams.get('key'));
            const file = assertFile(url.searchParams.get('file'));
            json(res, 200, { job: cancelMineru(mdKey(key, file)) ?? null });
            return;
        }
        if (sub === '/api/markdown/mineru/parse' && req.method === 'POST') {
            const key = assertKey(url.searchParams.get('key'));
            const file = assertFile(url.searchParams.get('file'));
            const base = await readNativeMdDocument(key, file) ?? await readMdDocument(key, file);
            if (!base)
                throw new HttpError('not-ready', 409, '请先生成基础文本视图');
            const body = await readJsonBody(req);
            if (body.page !== undefined && (!Number.isInteger(body.page) || !base.pages.some((page) => page.page === body.page))) {
                throw new HttpError('bad-page', 400, '待增强的页码无效');
            }
            json(res, 202, startMineru({ attachKey: key, file, pdfPath: attachPath(key, file), page: body.page }, base));
            return;
        }
        if ((sub === '/api/markdown/translate' || sub === '/api/markdown/mineru') && req.method === 'POST') {
            const key = assertKey(url.searchParams.get('key'));
            const file = assertFile(url.searchParams.get('file'));
            const doc = await readMdDocument(key, file);
            if (!doc)
                throw new HttpError('not-ready', 404, '文本视图还没生成');
            const dir = mdDir(key, file);
            if (sub.endsWith('/translate')) {
                const body = await readJsonBody(req);
                const page = doc.pages.find((entry) => entry.page === body.page);
                if (!page)
                    throw new HttpError('bad-page', 400, '该页不存在');
                json(res, 200, await translatePage(ctx, dir, page, body.prefetch === true));
            }
            else {
                const content = await readJsonBody(req);
                let next;
                try {
                    next = importMineru(content, await readNativeMdDocument(key, file) ?? doc);
                }
                catch (error) {
                    throw new HttpError('bad-mineru', 400, error.message);
                }
                if (getMdJob(mdKey(key, file))?.status === 'running')
                    throw new HttpError('busy', 409, '请等待当前解析任务完成');
                await saveMineruDocument(key, file, next);
                json(res, 200, next);
            }
            return;
        }
        if (sub === '/api/markdown/file' && req.method === 'GET') {
            const key = assertKey(url.searchParams.get('key'));
            const file = assertFile(url.searchParams.get('file'));
            const markdown = await readMdMarkdown(key, file);
            if (markdown === null)
                throw new HttpError('not-ready', 404, '文本视图还没生成');
            res.writeHead(200, {
                'content-type': 'text/markdown; charset=utf-8',
                'content-disposition': `attachment; filename="${encodeURIComponent(path.basename(file, path.extname(file)))}.md"`,
                'cache-control': 'no-store',
            });
            res.end(markdown);
            return;
        }
        /* ---------------- 静态资源 ---------------- */
        if (sub.startsWith('/vendor/') && req.method === 'GET') {
            const name = sub.slice('/vendor/'.length);
            if (!/^[A-Za-z0-9._-]+$/.test(name))
                throw new HttpError('bad-path', 400, '非法文件名');
            const ext = path.extname(name).toLowerCase();
            const types = {
                '.mjs': 'text/javascript; charset=utf-8',
                '.js': 'text/javascript; charset=utf-8',
                '.css': 'text/css; charset=utf-8',
                '.woff2': 'font/woff2',
                '.woff': 'font/woff',
                '.ttf': 'font/ttf',
                '.bcmap': 'application/octet-stream',
                '.json': 'application/json; charset=utf-8',
            };
            const file = fileURLToPath(new URL(`../vendor/${name}`, import.meta.url));
            await serveFile(req, res, file, types[ext] ?? 'application/octet-stream');
            return;
        }
        json(res, 404, { error: `未实现的路由: ${sub}` });
    }
    ctx.effect(() => {
        const dispose = ws.register({
            kind: 'prefix',
            path: '/lr-reader',
            handler: (req, res) => {
                const rejection = connection.requestRejection(req);
                if (rejection !== undefined) {
                    json(res, rejection, { error: rejection === 401 ? 'unauthorized' : 'forbidden' });
                    return;
                }
                const url = new URL(req.url ?? '/', 'http://x');
                dispatch(req, res, url).catch((err) => {
                    if (res.headersSent) {
                        res.end();
                        return;
                    }
                    if (err instanceof HttpError || err instanceof NotesError || err instanceof ZoteroError) {
                        json(res, err.status, { error: err.message, code: err.code });
                        return;
                    }
                    if (err instanceof LlmUnavailable) {
                        json(res, 409, { error: err.message, code: 'llm-unavailable' });
                        return;
                    }
                    const message = err instanceof Error ? err.message : String(err);
                    console.error('[dsh-zotero-reader] route error:', message);
                    json(res, 500, { error: message, code: 'internal' });
                });
            },
        });
        console.log('[dsh-zotero-reader] routes registered under /lr-reader');
        return dispose;
    });
}
