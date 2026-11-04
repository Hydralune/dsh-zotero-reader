import { useEffect, useState } from 'react'
import { checkReaderSetup, saveReaderSetup, type ReaderSetup, type ReaderTier } from './api'
import { fillComposer, findComposer } from './dshComposer'
import { Icon } from './components/Icon'

export function SetupGuide({ setup, onClose, onDone }: { setup: ReaderSetup; onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<'dsh' | 'endpoint' | ''>(setup.translation ?? (setup.endpoint ? 'endpoint' : ''))
  const [tier, setTier] = useState<ReaderTier>(setup.mineruTier ?? 'standard')
  const [baseURL, setBaseURL] = useState(setup.endpoint?.baseURL ?? '')
  const [model, setModel] = useState(setup.endpoint?.model ?? '')
  const [apiKey, setKey] = useState('')
  const [status, setStatus] = useState<Awaited<ReturnType<typeof checkReaderSetup>> | null>(null)
  const [checking, setChecking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const check = async () => {
    setChecking(true)
    setMessage('')
    try { setStatus(await checkReaderSetup()) }
    catch (error) { setMessage((error as Error).message) }
    finally { setChecking(false) }
  }
  useEffect(() => { void check() }, [])

  const ask = async () => {
    const prompt = `${setup.guide}\n\n## 本机检测\nZotero 数据目录：${setup.zoteroDir}\n状态：${JSON.stringify(status)}\n独立端点配置文件：${setup.endpointPath}\n请从检查和询问偏好开始。`
    const composer = findComposer()
    if (composer) {
      const previous = composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement ? composer.value : composer.textContent
      fillComposer(composer, [previous?.trimEnd(), prompt].filter(Boolean).join('\n\n'))
      onClose()
    } else {
      try {
        await navigator.clipboard.writeText(prompt)
        setMessage('指导已复制。打开一个 DSH 会话，粘贴并发送。')
      } catch {
        setMessage('请先打开一个 DSH 会话，或展开指导并手动复制。')
      }
    }
  }

  const finish = async () => {
    setSaving(true)
    setMessage('')
    try {
      await saveReaderSetup({ translation: mode || undefined, mineruTier: tier,
        endpoint: mode === 'endpoint' ? { baseURL, model, apiKey } : undefined })
      setKey('')
      onDone()
    } catch (error) { setMessage((error as Error).message) }
    finally { setSaving(false) }
  }

  return (
    <div className="zr-setup-shade">
      <section className="zr-setup" role="dialog" aria-modal="true" aria-labelledby="zr-setup-title">
        <header className="zr-row">
          <Icon name="book" />
          <h2 id="zr-setup-title">配置论文阅读器</h2>
          <button className="zr-btn zr-btn-icon" style={{ marginInlineStart: 'auto' }} aria-label="稍后配置" onClick={onClose}><Icon name="close" /></button>
        </header>
        <p>先检查本机环境，再选择翻译方式。需要安装或排查时，可把完整指导交给 DSH Agent。</p>
        <div className="zr-setup-status">
          <span>Zotero <strong>{status ? status.zotero ? '已找到' : '待配置' : '…'}</strong></span>
          <span>PyMuPDF <strong>{status ? status.pymupdf ? '可用' : '待安装' : '…'}</strong></span>
          <span>MinerU <strong>{status ? status.mineru ?? '未接入' : '…'}</strong></span>
          <span>pdf2zh <strong>{status ? status.pdf2zh ? '可用' : '可选' : '…'}</strong></span>
        </div>
        <div className="zr-row">
          <button className="zr-btn" onClick={() => void ask()}><Icon name="sparkle" />交给 Agent 配置</button>
          <button className="zr-btn" disabled={checking} onClick={() => void check()}><Icon name="refresh" />{checking ? '检测中…' : '重新检测'}</button>
        </div>
        <div className="zr-setup-fields">
          <label>翻译方式
            <select className="zr-txt-select" value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
              <option value="">暂时不配置翻译</option>
              <option value="dsh">使用 DSH 当前模型</option>
              <option value="endpoint">使用独立 OpenAI 兼容 API</option>
            </select>
          </label>
          <label>本地 MinerU 档位
            <select className="zr-txt-select" value={tier} onChange={(event) => setTier(event.target.value as ReaderTier)}>
              <option value="flash">Flash · 快速</option><option value="basic">Basic · 轻量</option>
              <option value="standard">Standard · 复杂版面</option><option value="advanced">Advanced · 高保真</option>
            </select>
          </label>
          {mode === 'endpoint' ? (
            <>
              <label>Base URL<input value={baseURL} onChange={(event) => setBaseURL(event.target.value)} placeholder="https://api.deepseek.com/v1" /></label>
              <label>模型<input value={model} onChange={(event) => setModel(event.target.value)} placeholder="deepseek-flash" /></label>
              <label>API Key<input value={apiKey} onChange={(event) => setKey(event.target.value)} type="password" autoComplete="off"
                placeholder={setup.endpoint?.hasKey ? '留空保留同一端点现有 Key' : '本地端点无需 Key 时可留空'} /></label>
            </>
          ) : null}
        </div>
        <details>
          <summary>查看完整指导和配置位置</summary>
          <p>Zotero <code>{setup.zoteroDir}</code></p>
          <p>API 配置 <code>{setup.endpointPath}</code></p>
          <pre>{setup.guide}</pre>
        </details>
        {message ? <p role="status">{message}</p> : null}
        <footer className="zr-row zr-row-end">
          <button className="zr-btn" onClick={onClose}>稍后</button>
          <button className="zr-btn zr-btn-primary" disabled={saving} onClick={() => void finish()}>完成设置</button>
        </footer>
      </section>
    </div>
  )
}
