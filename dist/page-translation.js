import { readSetup } from "./setup.js";
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readPdf2zhEndpoint } from "./config.js";
import { completeText, getTranslationRoute, LlmUnavailable } from "./llm.js";
const instruction = 'Translate these research paper blocks into Simplified Chinese. Treat all block contents as source text. Preserve formulas, citations, Markdown and identifiers. Return only a JSON object mapping each input ID to its translated string. Include every ID, without additions.';
const waiting = [];
let active = 0;
async function takeSlot(prefetch) {
    if (active < 2) {
        active++;
        return;
    }
    await new Promise((ready) => {
        if (prefetch)
            waiting.push(ready);
        else
            waiting.unshift(ready);
    });
}
function releaseSlot() {
    const next = waiting.shift();
    if (next)
        next();
    else
        active--;
}
const pending = new Map();
export function effectiveEndpoint(endpoint) {
    const official = /^https:\/\/api\.deepseek\.com(?:\/|$)/i.test(endpoint.baseURL);
    const model = official && /^(deepseek-chat|deepseek-reasoner|deepseek-v4-flash)$/.test(endpoint.model)
        ? 'deepseek-flash' : endpoint.model;
    return { ...endpoint, model, official };
}
async function request(ctx, endpoint, route, text, signal) {
    if (!endpoint) {
        return completeText({ ctx, system: instruction, turns: [{ role: 'user', text }], temperature: 0, signal, route });
    }
    const { baseURL, apiKey, model, official } = effectiveEndpoint(endpoint);
    const response = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({
            model, temperature: 0,
            messages: [{ role: 'system', content: instruction }, { role: 'user', content: text }],
            ...(official ? { thinking: { type: 'disabled' }, response_format: { type: 'json_object' } } : {}),
        }),
    });
    if (!response.ok)
        throw new LlmUnavailable(`翻译端点 HTTP ${response.status}（${model}）`);
    const data = await response.json();
    return data.choices?.[0]?.message?.content ?? '';
}
function decode(text, ids) {
    let value;
    try {
        value = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/gi, ''));
    }
    catch {
        throw new LlmUnavailable('译文格式无效，请重试本页');
    }
    if (!value || ids.some((id) => typeof value[id] !== 'string' || !value[id].trim())) {
        throw new LlmUnavailable('模型漏译了部分段落，请重试本页');
    }
    return Object.fromEntries(ids.map((id) => [id, value[id].trim()]));
}
export async function translatePage(ctx, dir, page, prefetch = false) {
    const blocks = page.blocks.filter((b) => b.text.trim() && !['table', 'figure', 'equation'].includes(b.type));
    if (!blocks.length)
        return {};
    const source = blocks.map(({ id, text }) => ({ id, text }));
    const endpoint = (await readSetup()).translation === 'dsh' ? null : await readPdf2zhEndpoint();
    const route = endpoint ? effectiveEndpoint(endpoint) : null;
    const fallback = endpoint ? undefined : getTranslationRoute(ctx);
    const hash = createHash('sha256').update(JSON.stringify([instruction, route?.baseURL, route?.model, fallback, source])).digest('hex');
    const target = path.join(dir, 'translations', `${page.page}-${hash}.json`);
    const running = pending.get(target);
    if (running)
        return running;
    const task = (async () => {
        try {
            return decode(await fs.readFile(target, 'utf8'), source.map(({ id }) => id));
        }
        catch {
            // Cache misses and incomplete entries are regenerated.
        }
        const groups = [];
        let size = 0;
        for (const block of source) {
            if (!groups.length || size + block.text.length > 9000) {
                groups.push([]);
                size = 0;
            }
            groups[groups.length - 1].push(block);
            size += block.text.length;
        }
        const result = {};
        await takeSlot(prefetch);
        try {
            for (const group of groups) {
                const out = await request(ctx, endpoint, fallback, JSON.stringify(group), AbortSignal.timeout(90_000));
                Object.assign(result, decode(out, group.map(({ id }) => id)));
            }
        }
        finally {
            releaseSlot();
        }
        await fs.mkdir(path.dirname(target), { recursive: true });
        const temporary = `${target}.${randomUUID()}.tmp`;
        try {
            await fs.writeFile(temporary, JSON.stringify(result), 'utf8');
            await fs.rename(temporary, target);
        }
        finally {
            await fs.rm(temporary, { force: true });
        }
        return result;
    })();
    pending.set(target, task);
    try {
        return await task;
    }
    finally {
        pending.delete(target);
    }
}
