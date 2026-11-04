import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { configDir, managedPython } from "./config.js";
import { probePython } from "./python.js";
export function setupPath() {
    return path.join(configDir(), 'setup.json');
}
export async function readSetup() {
    try {
        return JSON.parse(await fs.readFile(setupPath(), 'utf8')) ?? {};
    }
    catch {
        return {};
    }
}
export async function writeSetup(settings) {
    await fs.mkdir(configDir(), { recursive: true });
    const tmp = `${setupPath()}.${randomUUID()}.tmp`;
    try {
        await fs.writeFile(tmp, JSON.stringify(settings, null, 2), { mode: 0o600 });
        await fs.rename(tmp, setupPath());
    }
    finally {
        await fs.rm(tmp, { force: true });
    }
}
export async function claimReaderWelcome() {
    if ((await readSetup()).completed)
        return false;
    const dir = configDir();
    await fs.mkdir(dir, { recursive: true });
    try {
        const marker = await fs.open(path.join(dir, 'welcome-seen'), 'wx', 0o600);
        await marker.close();
        return true;
    }
    catch (error) {
        if (error.code === 'EEXIST')
            return false;
        throw error;
    }
}
export function defaultZoteroDir() {
    return path.join(os.homedir(), 'Zotero');
}
export async function detectMineru() {
    const python = process.env.LR_MINERU_PYTHON || managedPython();
    try {
        await fs.access(python);
    }
    catch {
        return null;
    }
    const result = await probePython(python, "from importlib.metadata import version; from mineru.parser import parse; from mineru.render import RenderFormat; print(version('mineru'))", 15_000);
    const version = result.ok ? result.out.split(/\r?\n/).at(-1) : undefined;
    return version && /^4\.(?:[1-9]\d*)\./.test(version) ? { python, version } : null;
}
