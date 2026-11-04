import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { notesPath, NotesError } from "./notes.js";
const locks = new Map();
const targetPath = (key, file) => notesPath(key, file).replace(/\.json$/, '.text.json');
function normalize(value) {
    const raw = value;
    if (!raw || !['highlight', 'underline', 'strike'].includes(raw.kind) ||
        !/^#[0-9a-f]{6}$/i.test(raw.color) || !Number.isInteger(raw.page) || raw.page < 1 ||
        !Array.isArray(raw.anchors) || !raw.anchors.length || raw.anchors.length > 1000) {
        throw new NotesError('bad-text-mark', 400, '文本标注无效');
    }
    const anchors = raw.anchors.map((a) => {
        if (!a || typeof a.block !== 'string' || a.block.length > 160 ||
            !['original', 'translation'].includes(a.side) ||
            !Number.isInteger(a.start) || !Number.isInteger(a.end) || a.start < 0 || a.end <= a.start ||
            typeof a.quote !== 'string' || a.quote.length > 200000 || a.quote.length !== a.end - a.start) {
            throw new NotesError('bad-text-anchor', 400, '文本选区无效');
        }
        return { block: a.block, side: a.side, start: a.start, end: a.end, quote: a.quote };
    });
    return { id: typeof raw.id === 'string' && /^[\w-]{1,64}$/.test(raw.id) ? raw.id : randomUUID(),
        kind: raw.kind, color: raw.color, page: raw.page,
        text: typeof raw.text === 'string' ? raw.text.slice(0, 200000) : anchors.map((a) => a.quote).join('\n'),
        anchors, createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString() };
}
export async function readTextMarks(key, file) {
    try {
        const data = JSON.parse(await fs.readFile(targetPath(key, file), 'utf8'));
        return Array.isArray(data.marks) ? data.marks.map(normalize) : [];
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return [];
        throw error;
    }
}
export async function changeTextMarks(key, file, change) {
    const target = targetPath(key, file);
    const task = (locks.get(target) ?? Promise.resolve()).catch(() => { }).then(async () => {
        let marks = await readTextMarks(key, file);
        if (change.add)
            marks.push(normalize(change.add));
        else {
            if (!marks.some((mark) => mark.id === change.id))
                throw new NotesError('not-found', 404, '文本标注不存在');
            marks = change.patch ? marks.map((mark) => mark.id === change.id ? normalize({ ...mark, ...change.patch }) : mark)
                : marks.filter((mark) => mark.id !== change.id);
        }
        await fs.mkdir(path.dirname(target), { recursive: true });
        const temporary = `${target}.${randomUUID()}.tmp`;
        try {
            await fs.writeFile(temporary, JSON.stringify({ version: 1, marks }), 'utf8');
            await fs.rename(temporary, target);
        }
        finally {
            await fs.rm(temporary, { force: true });
        }
        return marks;
    });
    locks.set(target, task);
    try {
        return await task;
    }
    finally {
        if (locks.get(target) === task)
            locks.delete(target);
    }
}
