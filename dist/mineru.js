export function importMineru(content, original) {
    if (!Array.isArray(content))
        throw new Error('请选择 MinerU 导出的 *_content_list.json');
    const pages = original.pages.map((page) => ({ ...page, blocks: [] }));
    for (const item of content) {
        if (!item || !Number.isInteger(item.page_idx) || item.page_idx < 0 || item.page_idx >= pages.length)
            continue;
        const page = pages[item.page_idx];
        const strings = (value) => Array.isArray(value)
            ? value.filter((part) => typeof part === 'string').join('\n')
            : '';
        let text = typeof item.text === 'string' ? item.text.trim() : '';
        let type;
        switch (item.type) {
            case 'reference':
                type = 'text';
                break;
            case 'text':
                type = item.text_level > 0 ? 'title' : 'text';
                break;
            case 'list':
                type = 'list';
                text ||= strings(item.list_items);
                break;
            case 'equation':
                type = 'equation';
                break;
            case 'image':
                text ||= strings(item.img_caption);
                type = 'figure';
                break;
            case 'table':
                text ||= strings(item.table_caption);
                type = 'table';
                break;
            default: continue;
        }
        // Standard/Flash may return an equation image without any recognized LaTeX.
        // Render the original PDF region rather than dropping it or guessing symbols.
        const media = type === 'figure' || type === 'table' || type === 'equation';
        if (!text && !media)
            continue;
        const raw = item.bbox;
        const positioned = Array.isArray(raw) && raw.length === 4 &&
            raw.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1000) &&
            raw[2] > raw[0] && raw[3] > raw[1];
        let bbox = positioned ? raw.map((n) => n / 1000) : [0, 0, 0, 0];
        if (media && !positioned) {
            const candidates = original.pages[item.page_idx].blocks.filter((block) => block.type === type && block.crop);
            const alreadyAdded = page.blocks.filter((block) => block.type === type).length;
            const count = content.filter((entry) => entry?.page_idx === item.page_idx && entry.type === item.type).length;
            if (candidates.length === count)
                bbox = candidates[alreadyAdded]?.bbox ?? bbox;
        }
        const numbering = /^(\d+(?:\.\d+)+)\.?\s/.exec(text);
        const level = type === 'title' ? Math.min(4, Math.max(Number(item.text_level) || 1, numbering?.[1].split('.').length ?? 1)) : undefined;
        if (media) {
            const crop = bbox[2] > bbox[0];
            page.blocks.push({ id: `p${page.page}-${page.blocks.length}`, type, text: type === 'equation' ? text : '', bbox, crop });
            if (type === 'equation')
                continue;
            if (!text)
                continue;
            type = 'caption';
        }
        page.blocks.push({ id: `p${page.page}-${page.blocks.length}`, type, text, bbox, level, ...(item.type === 'reference' ? { role: 'reference' } : {}) });
    }
    if (!pages.some((page) => page.blocks.length))
        throw new Error('该文件没有可读取的 MinerU 文本块');
    if (content.some((item) => Number.isInteger(item?.page_idx) && item.page_idx >= pages.length)) {
        throw new Error('MinerU 导出的页码超过当前 PDF，请选择对应论文的文件');
    }
    const outline = original.outline?.map((entry) => ({
        ...entry,
        blockId: pages[entry.page - 1]?.blocks.find((block) => block.type === 'title' &&
            block.text.trim().toLowerCase() === entry.title.trim().toLowerCase())?.id,
    }));
    return { ...original, source: 'mineru', parser: undefined, pages, outline };
}
