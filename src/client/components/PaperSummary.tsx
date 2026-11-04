import { useEffect, useRef, useState } from 'react'
import type { ZoteroPaper } from '../api'
import { explainPreparedInDsh } from '../dshComposer'
import { DEFAULT_PAPER_PROMPT, DEFAULT_SUMMARY_SHORTCUT, normalizeSummarySettings, preparePaperSummary,
  shortcutFromEvent, SUMMARY_SETTINGS_KEY, type SummarySettings } from '../paper-summary'
import { Icon } from './Icon'

export function PaperSummary({ paper, onNotify }: { paper: ZoteroPaper | null; onNotify: (message: string) => void }) {
  const [settings, setSettings] = useState<SummarySettings>(() => {
    try { return normalizeSummarySettings(JSON.parse(localStorage.getItem(SUMMARY_SETTINGS_KEY) || 'null')) }
    catch { return normalizeSummarySettings(null) }
  })
  const [draft, setDraft] = useState(settings)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState('')
  const [error, setError] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const flight = useRef(false)
  const openEditor = () => { setDraft(settings); setError(''); setEditing(true) }
  const send = async () => {
    if (!paper || flight.current) return
    flight.current = true; setBusy(true)
    try {
      await explainPreparedInDsh(async () => {
        const request = await preparePaperSummary(paper, settings.prompt, setStage)
        setStage('正在发送论文解读…')
        return request
      })
      onNotify('完整论文和解读规则已发送到当前会话')
    } catch (cause) { onNotify(`论文解读未发送：${(cause as Error).message}`) }
    finally { flight.current = false; setBusy(false); setStage('') }
  }
  const latest = useRef({ send, settings, editing })
  latest.current = { send, settings, editing }
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const current = latest.current
      if (event.defaultPrevented || event.repeat || current.editing || !button.current?.getClientRects().length) return
      const target = event.target as HTMLElement | null
      if (target?.closest?.('input,textarea,select,[contenteditable="true"]')) return
      if (current.settings.shortcut && shortcutFromEvent(event) === current.settings.shortcut) {
        event.preventDefault(); void current.send()
      }
    }
    document.addEventListener('keydown', keydown)
    return () => document.removeEventListener('keydown', keydown)
  }, [])
  useEffect(() => {
    if (editing) dialog.current?.showModal()
  }, [editing])
  return <>
    <button ref={button} type="button" className="zr-btn zr-btn-icon zr-paper-summary" aria-label="解读整篇论文"
      aria-busy={busy} aria-keyshortcuts={settings.shortcut || undefined} disabled={!paper || busy}
      title={busy ? stage : `解读整篇论文${settings.shortcut ? ` (${settings.shortcut})` : ''} · 右键编辑提示词`}
      onClick={() => void send()} onContextMenu={event => { event.preventDefault(); openEditor() }}
      onKeyDown={event => { if (event.altKey && event.key === 'Enter') { event.preventDefault(); openEditor() } }}>
      <Icon name={busy ? 'refresh' : 'paperSummary'} />
    </button>
    {editing ? <dialog ref={dialog} className="zr-summary-dialog" aria-labelledby="zr-summary-title"
      onCancel={() => setEditing(false)} onClick={event => { if (event.target === dialog.current) setEditing(false) }}
      onKeyDown={event => event.stopPropagation()}>
      <form onSubmit={event => {
        event.preventDefault()
        if (!draft.prompt.trim()) { setError('请输入解读提示词'); return }
        try { localStorage.setItem(SUMMARY_SETTINGS_KEY, JSON.stringify(draft)) }
        catch { setError('无法保存到本地，请检查浏览器存储权限'); return }
        setSettings(draft); setEditing(false); onNotify('论文解读设置已保存')
      }}>
        <header><span className="zr-summary-emblem"><Icon name="paperSummary" size={22} /></span>
          <div><h2 id="zr-summary-title">定制论文解读</h2><p>单击图标发送整篇论文，右键随时调整。</p></div>
          <button type="button" className="zr-btn zr-btn-icon" aria-label="关闭解读设置" onClick={() => setEditing(false)}><Icon name="close" /></button>
        </header>
        <div className="zr-summary-body">
          <div className="zr-summary-shortcut-row"><div><label htmlFor="zr-summary-shortcut">键盘快捷键</label><p>点击右侧，按下新的组合键；退格清除。</p></div>
            <input id="zr-summary-shortcut" aria-label="论文解读快捷键" readOnly value={draft.shortcut} placeholder="未设置"
              onKeyDown={event => {
                if (event.key === 'Tab') return
                event.preventDefault()
                if (event.key === 'Backspace' || event.key === 'Delete') { setDraft({ ...draft, shortcut: '' }); setError(''); return }
                const shortcut = shortcutFromEvent(event.nativeEvent)
                if (shortcut) { setDraft({ ...draft, shortcut }); setError('') }
                else if (!['Control', 'Alt', 'Meta', 'Shift'].includes(event.key)) setError('请使用 Ctrl、Alt 或 Command 加字母/数字的组合键')
              }} />
          </div>
          <label htmlFor="zr-summary-prompt">解读提示词 <span>通用学术框架 · 可自由编辑</span></label>
          <textarea id="zr-summary-prompt" value={draft.prompt} spellCheck={false} onChange={event => setDraft({ ...draft, prompt: event.target.value })} />
          <p className="zr-summary-footnote">发送原始 PDF、逐页全文和本地来源。提示词保存于本机，不占用聊天输入框。</p>
          {error ? <p className="zr-summary-error" role="alert">{error}</p> : null}
        </div>
        <footer><button type="button" className="zr-btn" onClick={() => { setDraft({ prompt: DEFAULT_PAPER_PROMPT, shortcut: DEFAULT_SUMMARY_SHORTCUT }); setError('') }}>恢复默认</button>
          <span /><button type="button" className="zr-btn" onClick={() => setEditing(false)}>取消</button>
          <button type="submit" className="zr-btn zr-summary-save">保存设置</button></footer>
      </form>
    </dialog> : null}
  </>
}
