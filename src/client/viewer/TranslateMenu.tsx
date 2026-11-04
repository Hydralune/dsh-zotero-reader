// TranslateMenu.tsx — 整篇翻译的入口：端点配置 + 生成 + 三态切换。
//
// 唯一需要单独填凭据的能力（pdf2zh 是独立 Python 进程，吃 OpenAI 兼容端点）。
// 没配置时这里就是表单，不再给「点了没反应」的假按钮。
import { useCallback, useEffect, useState } from 'react'
import {
  getPdf2zhConfig,
  getTranslateStatus,
  savePdf2zhConfig,
  startTranslate,
  type Pdf2zhConfig,
  type TranslateJob,
  type ZoteroPaper,
} from '../api'
import { Icon } from '../components/Icon'

export interface TranslateMenuProps {
  paper: ZoteroPaper
  variant: string
  onBilingual: () => void
  onVariant: (variant: string) => void
  onClose: () => void
  onNotify: (text: string) => void
}

export function TranslateMenu({ paper, variant, onBilingual, onVariant, onClose, onNotify }: TranslateMenuProps) {
  const [config, setConfig] = useState<Pdf2zhConfig | null>(null)
  const [job, setJob] = useState<TranslateJob | null>(null)
  const [variants, setVariants] = useState<string[]>(paper.variants ?? [])
  const [form, setForm] = useState({ baseURL: '', apiKey: '', model: 'deepseek-flash' })
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)

  const stem = paper.file.replace(/\.pdf$/i, '')

  const refresh = useCallback(async () => {
    try {
      const [cfg, status] = await Promise.all([getPdf2zhConfig(), getTranslateStatus(paper)])
      setConfig(cfg)
      setJob(status.job)
      setVariants(status.variants)
      if (cfg.baseURL) setForm((f) => f.baseURL ? f : { ...f, baseURL: cfg.baseURL, model: cfg.model || f.model })
    } catch {
      /* 忽略：下面按未配置处理 */
    }
  }, [paper])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // 任务进行中轮询
  useEffect(() => {
    if (job?.status !== 'running') return
    const timer = window.setInterval(() => void refresh(), 2500)
    return () => window.clearInterval(timer)
  }, [job?.status, refresh])

  const save = useCallback(async () => {
    setBusy(true)
    try {
      await savePdf2zhConfig(form)
      setEditing(false)
      setForm((previous) => ({ ...previous, apiKey: '' }))
      onNotify('端点已保存')
      await refresh()
    } catch (e) {
      onNotify(`保存失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }, [form, refresh, onNotify])

  const generate = useCallback(async () => {
    setBusy(true)
    try {
      setJob(await startTranslate(paper))
    } catch (e) {
      onNotify((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [paper, onNotify])

  const options: Array<{ label: string; value: string }> = [
    { label: '原文', value: '' },
    { label: '纯译文', value: `${stem}-zh.pdf` },
    { label: '中英对照', value: `${stem}-dual.pdf` },
  ].filter((o) => o.value === '' || variants.includes(o.value))

  return (
    <div className="zr-menu">
      <div className="zr-menu-head">
        <Icon name="translate" />
        <span>论文翻译</span>
        <button className="zr-btn zr-btn-icon" style={{ marginLeft: 'auto' }} onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>

      <div className="zr-menu-body">
        <button className="zr-btn zr-btn-primary" onClick={onBilingual}>按页阅读 · 中英对照</button>
        <div className="zr-muted" style={{ marginTop: 6, fontSize: 11.5 }}>
          当前页先请求，同时预取下一页。{config?.configured ? '使用下面的翻译端点。' : '未设独立端点时，使用 DSH 当前模型。'}
        </div>
      </div>
      {!config?.configured || editing ? (
        <div className="zr-menu-body">
          <div className="zr-muted" style={{ fontSize: 11.5, lineHeight: 1.6 }}>
            配置 OpenAI 兼容端点后，按页阅读与整篇 PDF 导出均使用该端点。PDF 导出产出 <span className="zr-mono">-zh.pdf</span> /{' '}
            <span className="zr-mono">-dual.pdf</span>。
          </div>
          <input
            className="zr-input"
            style={{ minHeight: 0, height: 28, marginTop: 8 }}
            placeholder="Base URL，例如 https://api.deepseek.com/v1"
            value={form.baseURL}
            onChange={(e) => setForm({ ...form, baseURL: e.target.value })}
          />
          <input
            className="zr-input"
            style={{ minHeight: 0, height: 28, marginTop: 6 }}
            placeholder="API Key"
            type="password"
            value={form.apiKey}
            onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
          />
          <input
            className="zr-input"
            style={{ minHeight: 0, height: 28, marginTop: 6 }}
            placeholder="模型名，例如 deepseek-flash"
            value={form.model}
            onChange={(e) => setForm({ ...form, model: e.target.value })}
          />
          <div className="zr-row zr-row-end" style={{ marginTop: 8 }}>
            <button className="zr-btn zr-btn-primary" disabled={busy || !form.baseURL || !form.model} onClick={() => void save()}>
              保存
            </button>
          </div>
        </div>
      ) : (
        <div className="zr-menu-body">
          <div className="zr-muted zr-mono" style={{ fontSize: 11 }}>
            {config.baseURL} · {config.model} · {config.keyMask || '无 Key'}
            <button className="zr-btn" onClick={() => setEditing(true)}>编辑端点</button>
          </div>

          {job?.status === 'running' ? (
            <div style={{ marginTop: 8 }}>
              <div className="zr-progress">
                <div className="zr-progress-fill" style={{ width: `${Math.max(4, job.percent)}%` }} />
              </div>
              <div className="zr-muted" style={{ fontSize: 11, marginTop: 4 }}>
                {job.stage} {job.percent}%
              </div>
            </div>
          ) : null}

          {job?.status === 'error' ? (
            <div style={{ marginTop: 8, color: 'var(--zr-danger)', fontSize: 11.5 }}>{job.error}</div>
          ) : null}

          {options.length > 1 ? (
            <div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {options.map((o) => (
                <button
                  key={o.value}
                  className="zr-chip"
                  data-active={variant === o.value ? '' : undefined}
                  onClick={() => {
                    onVariant(o.value)
                    onClose()
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          ) : null}

          <div className="zr-row zr-row-end" style={{ marginTop: 8 }}>
            <button
              className="zr-btn zr-btn-primary"
              disabled={busy || job?.status === 'running'}
              onClick={() => void generate()}
            >
              {job?.status === 'running' ? '生成中…' : variants.length ? '重新导出 PDF' : '整篇导出 PDF'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default TranslateMenu
