import { useEffect, useRef } from 'react'
import { bindExplanationComposer, readerAttachmentFor, type ReaderAttachment } from '../dshComposer'
import { Icon } from './Icon'

interface DraftAttachment { id: string; kind: 'file' | 'image'; file: File; previewUrl?: string }
interface Props {
  sessionId?: string
  attachments: DraftAttachment[]
  uploads: Record<string, { status: string; error?: string } | undefined>
  canAcceptDrop?: boolean
  onAddFiles: (files: File[], directories?: Set<File>) => unknown
  onRemoveAttachment: (id: string) => void
  onRetryFile: (id: string) => void
}

export function attachmentGroups(attachments: DraftAttachment[]) {
  const groups = new Map<string, { reference?: ReaderAttachment; files: DraftAttachment[] }>()
  for (const attachment of attachments) {
    let reference = readerAttachmentFor(attachment.file)
    // Drafts can outlive a plugin reload. Their unique filename preserves grouping.
    const marker = /^\[lr-([\w-]+)\] (.*)$/.exec(attachment.file.name)
    if (!reference && marker) reference = { id: marker[1], screenshot: /截图|\.png$/i.test(marker[2]),
      parts: { intent: 'quote', page: Number(/第(\d+)页|p(\d+)/.exec(marker[2])?.slice(1).find(Boolean)) || undefined,
        text: marker[2].replace(/\.[^.]+$/, ''), title: '论文引用' } }
    const key = reference?.id ?? attachment.id
    const group = groups.get(key) ?? { reference, files: [] }
    group.files.push(attachment)
    if (reference?.screenshot) group.reference = reference
    groups.set(key, group)
  }
  return [...groups.entries()]
}

/** Native draft ownership, uploading, removal and submission stay with DSH. */
export function ReaderAttachments({ attachments = [], uploads = {}, canAcceptDrop, onAddFiles, onRemoveAttachment, onRetryFile, sessionId }: Props) {
  const marker = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const card = marker.current?.closest('[data-composer-card]')
    const box = card?.querySelector<HTMLElement>('[role="textbox"],textarea')
    if (box && sessionId) return bindExplanationComposer(box, sessionId)
  }, [sessionId])
  useEffect(() => {
    const hasFiles = (event: DragEvent) => [...(event.dataTransfer?.types ?? [])].includes('Files')
    const over = (event: DragEvent) => { if (canAcceptDrop && hasFiles(event)) event.preventDefault() }
    const drop = (event: DragEvent) => {
      if (!canAcceptDrop || !hasFiles(event) || !event.dataTransfer) return
      event.preventDefault()
      const files: File[] = [], directories = new Set<File>()
      for (const item of event.dataTransfer.items) {
        const file = item.getAsFile()
        if (!file) continue
        files.push(file)
        if (item.webkitGetAsEntry?.()?.isDirectory) directories.add(file)
      }
      onAddFiles(files, directories)
    }
    document.addEventListener('dragover', over)
    document.addEventListener('drop', drop)
    return () => { document.removeEventListener('dragover', over); document.removeEventListener('drop', drop) }
  }, [canAcceptDrop, onAddFiles])
  return <><span ref={marker} hidden data-zr-composer-binding="true" />{attachments.length ? <div className="zr-quote-confirmed-list" aria-label="已附加引用与文件">
    {attachmentGroups(attachments).map(([key, group]) => {
      const reference = group.reference
      const failed = group.files.filter(file => uploads[file.id]?.status === 'error')
      const pending = group.files.some(file => file.kind === 'file' && uploads[file.id]?.status !== 'ready')
      const image = group.files.find(file => file.kind === 'image')
      return <div key={key} className="zr-quote-preview zr-quote-confirmed" data-status={failed.length ? 'error' : pending ? 'uploading' : 'ready'}>
        <Icon name={reference ? reference.screenshot ? 'capture' : 'quote' : image ? 'thumbnails' : 'file'} />
        <div className="zr-quote-preview-body">
          <small>{failed.length ? '附加失败' : pending ? '正在附加' : reference ? '已引用' : '已附加'}{reference?.screenshot ? ' · 截图' : ''}
            {reference?.parts.page ? ` · 第 ${reference.parts.page} 页` : ''}{reference?.parts.title ? ` · ${reference.parts.title}` : ''}</small>
          <span>{reference ? reference.screenshot ? '已框选截图，可输入问题或直接发送解释' : reference.parts.text?.replace(/\s+/g, ' ').slice(0, 120) : group.files[0].file.name}</span>
        </div>
        {image?.previewUrl ? <a className="zr-quote-preview-button" href={image.previewUrl} target="_blank" rel="noopener noreferrer" aria-label="查看引用截图"><Icon name="search" /></a> : null}
        {failed.length ? <button type="button" className="zr-quote-preview-button" aria-label="重试附加" onClick={() => failed.forEach(file => onRetryFile(file.id))}><Icon name="refresh" /></button> : null}
        <button type="button" className="zr-quote-preview-button" aria-label="移除引用" onClick={() => group.files.forEach(file => onRemoveAttachment(file.id))}><Icon name="close" /></button>
      </div>
    })}
  </div> : null}</>
}
