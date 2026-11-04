import type { MdBlock, MdDocument } from './markdown.ts'

const referenceHeading = /^(?:(?:\d+|[IVX]+)\.?\s+)?(?:references?|bibliography|参考文献)\s*$/i
const followingSection = /^(?:appendi(?:x|ces)\b|[A-Z](?:\.\d+)*[.\s]+\w|acknowledg(?:e)?ments?\b|supplement(?:ary)?\b)/i

/** Normalize cached as well as newly parsed bibliography blocks. */
export function normalizeReferences(doc: MdDocument): MdDocument {
  const firstReferencePage = doc.pages.find((page) => page.blocks.some((block) => referenceHeading.test(block.text.trim())))?.page
  let inReferences = false
  const referenceIDs = new Set<string>()
  const pages = doc.pages.map((page) => ({
    ...page,
    blocks: page.blocks.flatMap((block): MdBlock[] => {
      const text = block.text.trim()
      if (referenceHeading.test(text)) {
        inReferences = true
        return [{ ...block, type: 'title', level: 1, role: undefined }]
      }
      if ((block.type === 'title' && followingSection.test(text)) || /^(?:[A-Z](?:\.\d+)*\s+[A-Z]{3}|appendi(?:x|ces)\b)/.test(text)) inReferences = false
      const numbered = /^\[\d{1,4}\]\s+\S/.test(text)
      const bibliographyRun = firstReferencePage !== undefined && page.page >= firstReferencePage && (text.match(/\[\d{1,4}\]\s+\S/g)?.length ?? 0) >= 2
      if (inReferences && block.bbox[1] < 0.08 && !numbered && !bibliographyRun && block.role !== 'reference') return [{ ...block, type: block.type === 'title' ? 'text' : block.type, level: undefined }]
      if (!inReferences && !numbered && !bibliographyRun && block.role !== 'reference') return [block]
      if (!['text', 'title', 'list'].includes(block.type)) return [block]
      if (inReferences && block.type === 'title' && !numbered && text.length < 10) {
        return [{ ...block, type: 'text', level: undefined }]
      }
      const entries = text.split(/\s+(?=\[\d{1,4}\]\s+\S)/).filter(Boolean)
      if (!numbered && !inReferences && !bibliographyRun && block.role !== 'reference') return [block]
      return entries.map((entry, index) => {
        const id = index === 0 ? block.id : `${block.id}-ref-${index}`
        referenceIDs.add(id)
        return { ...block, id, text: entry, type: 'text', role: 'reference', level: undefined }
      })
    }),
  }))
  return { ...doc, pages, outline: doc.outline?.filter((entry) =>
    referenceHeading.test(entry.title) || !entry.blockId || !referenceIDs.has(entry.blockId),
  ) }
}
