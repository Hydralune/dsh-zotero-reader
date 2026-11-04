import type { TextAnchor } from '../api'
import type { QuoteParts } from '../dshComposer'
import type { ViewportRect } from './selection-anchor'

function blockContext(block: HTMLElement) {
  const page = Number(block.closest<HTMLElement>('[data-text-page]')?.dataset.textPage) || 1
  const original = block.querySelector<HTMLElement>('[data-text-side="original"]')?.textContent?.trim() ?? ''
  const translation = block.querySelector<HTMLElement>('[data-text-side="translation"]')?.textContent?.trim()
  return { page, block: block.id.replace(/^zr-block-/, ''),
    bbox: block.dataset.sourceBbox ? JSON.parse(block.dataset.sourceBbox) as number[] : undefined,
    original, translation }
}

export function textSelectionContext(root: HTMLElement | null, anchors: TextAnchor[]): Pick<QuoteParts, 'locations' | 'context'> {
  if (!root) return {}
  const blocks = [...root.querySelectorAll<HTMLElement>('.zr-txt-pair[id]')]
  const selected = blocks.filter(block => anchors.some(anchor => block.id === `zr-block-${anchor.block}`)).map(blockContext)
  return { locations: selected.map(({ page, block, bbox }) => ({ page, block, bbox,
    anchors: anchors.filter(anchor => anchor.block === block) })),
    context: selected.map(block => `第 ${block.page} 页 / 段落 ${block.block}\n原文：${block.original}${block.translation ? `\n译文：${block.translation}` : ''}`).join('\n\n') }
}

export function textCaptureContext(root: HTMLElement, rect: ViewportRect): Pick<QuoteParts, 'locations' | 'context' | 'text'> {
  const selected = [...root.querySelectorAll<HTMLElement>('.zr-txt-pair[id]')].filter(block => {
    const box = block.getBoundingClientRect()
    return box.bottom > rect.top && box.top < rect.bottom && box.right > rect.left && box.left < rect.right
  }).map(blockContext)
  return { locations: selected.map(({ page, block, bbox }) => ({ page, block, bbox })),
    text: '随附图片为用户框选截图；下方是与选框相交的完整段落，不表示段落中的所有文字均在截图内。',
    context: selected.map(block => `第 ${block.page} 页 / 段落 ${block.block}\n原文：${block.original}${block.translation ? `\n译文：${block.translation}` : ''}`).join('\n\n') }
}
