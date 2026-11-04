import { configureExplanationTransport, quoteContents, quoteFilename } from './dshComposer'

export function installNativeExplanation(context: { get(name: string): unknown }) {
  return configureExplanationTransport(async (sessionId, { parts, image }) => {
      // Use DSH's native admission/echo path, independently of the editor draft.
      const sessions = context.get('sessions') as { binding(id: string): { session: unknown } | undefined } | undefined
      const conversation = context.get('conversation') as {
        createDrafts(id: string, files: File[]): Array<{ id: string }>
        fileUploads: { getSnapshot(): Record<string, { status: string; error?: string } | undefined> }
        sendSession(session: unknown, text: string, ids: string[], mode: string): Promise<{ kind: string }>
        releaseDraftAttachments(drafts: Array<{ id: string }>): void
      } | undefined
      const binding = sessions?.binding(sessionId)
      if (!binding || !conversation) throw new Error('当前会话不可用，请重新打开会话')
      const files = [image ?? new File([quoteContents(parts)], quoteFilename(parts), { type: 'text/plain' })]
      const drafts = conversation.createDrafts(sessionId, files)
      let admitted = false
      try {
        if (!image) {
          const deadline = Date.now() + 60_000
          while (true) {
            const uploads = conversation.fileUploads.getSnapshot()
            const states = drafts.map(draft => uploads[draft.id])
            if (states.some(state => state?.status === 'error')) throw new Error('引用内容上传失败，请重试')
            if (states.every(state => state?.status === 'ready')) break
            if (Date.now() >= deadline) throw new Error('引用内容上传超时，请重试')
            await new Promise(resolve => setTimeout(resolve, 100))
          }
        }
        if (sessions?.binding(sessionId) !== binding) throw new Error('会话已切换，请重新点击解释')
        const result = await conversation.sendSession(binding.session,
          `请用中文解释《${parts.title || '当前文献'}》${parts.page ? `第 ${parts.page} 页` : ''}的这${image ? '张图片' : '段引用'}，说明其含义及在论文中的作用。`,
          drafts.map(draft => draft.id), 'queue')
        if (result.kind !== 'success') throw new Error('解释请求未发送成功，请检查对话中的错误提示')
        admitted = true
      } finally { if (!admitted) conversation.releaseDraftAttachments(drafts) }
  })
}
