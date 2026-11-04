import type { TextAnchor } from '../api'

export function textRunRange(element: HTMLElement, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  let offset = 0
  let started = false
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0
    if (!started && start <= offset + length) {
      range.setStart(node, Math.max(0, start - offset))
      started = true
    }
    if (started && end <= offset + length) {
      range.setEnd(node, Math.max(0, end - offset))
      return range
    }
    offset += length
  }
  return null
}

export function anchorRange(root: HTMLElement, anchor: TextAnchor): Range | null {
  const run = root.querySelector<HTMLElement>(`[data-text-block="${CSS.escape(anchor.block)}"][data-text-side="${anchor.side}"]`)
  if (!run || run.textContent?.slice(anchor.start, anchor.end) !== anchor.quote) return null
  return textRunRange(run, anchor.start, anchor.end)
}

export function selectedTextAnchors(root: HTMLElement, range: Range): TextAnchor[] {
  const anchors: TextAnchor[] = []
  for (const run of root.querySelectorAll<HTMLElement>('[data-text-block][data-text-side]')) {
    if (!range.intersectsNode(run)) continue
    const part = document.createRange()
    part.selectNodeContents(run)
    if (run.contains(range.startContainer)) part.setStart(range.startContainer, range.startOffset)
    if (run.contains(range.endContainer)) part.setEnd(range.endContainer, range.endOffset)
    const quote = part.toString()
    if (!quote.trim()) continue
    const before = document.createRange()
    before.selectNodeContents(run)
    before.setEnd(part.startContainer, part.startOffset)
    const start = before.toString().length
    anchors.push({ block: run.dataset.textBlock!, side: run.dataset.textSide as TextAnchor['side'], start, end: start + quote.length, quote })
  }
  return anchors
}

interface HighlightRegistry {
  set(name: string, highlight: unknown): void
  delete(name: string): void
}
export function textHighlightAPI() {
  const registry = (CSS as unknown as { highlights?: HighlightRegistry }).highlights
  const Highlight = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
  return registry && Highlight ? { registry, Highlight } : null
}
