// config.ts — 插件自己的落盘位置。
// 全部放在 <DSH_HOME>/.dsh-lr-reader/ 下：不进用户 Zotero 库，也不进文献库目录。
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
export function dshHome() {
    return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}
/** <DSH_HOME>/.dsh-lr-reader */
export function configDir() {
    return path.join(dshHome(), '.dsh-lr-reader');
}
export function managedPython() {
    return path.join(configDir(), 'env', ...(process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python']));
}
/** 高亮与笔记：一篇文章一份 json，按 Zotero 附件 key 命名 */
export function notesDir() {
    return path.join(configDir(), 'notes');
}
export function pdf2zhConfigPath() {
    return path.join(configDir(), 'pdf2zh.json');
}
export async function readPdf2zhEndpoint() {
    try {
        const raw = JSON.parse(await fs.readFile(pdf2zhConfigPath(), 'utf8'));
        if (!raw.baseURL || !raw.model)
            return null;
        return { baseURL: String(raw.baseURL), apiKey: String(raw.apiKey ?? ''), model: String(raw.model) };
    }
    catch {
        return null;
    }
}
export async function savePdf2zhEndpoint(next) {
    const dir = configDir();
    await fs.mkdir(dir, { recursive: true });
    const target = pdf2zhConfigPath();
    const tmp = `${target}.tmp-${process.pid}`;
    await fs.writeFile(tmp, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(tmp, target);
    try {
        await fs.chmod(target, 0o600);
    }
    catch {
        /* Windows 上可能无效 */
    }
}
/** 打码回显，绝不回明文 */
export function maskKey(key) {
    if (!key)
        return '';
    if (key.length <= 8)
        return '••••';
    return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}
