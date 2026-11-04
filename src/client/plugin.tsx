// plugin.tsx — 浏览器半边入口。
//
// 目标形态（用户明确）：点「论文阅读」→ **对话仍在中间**，论文出现在最右侧。
//
// 从 DSH 源码读到、决定实现方式的三条硬事实：
//   1. `ui-sidebar-right` 里：
//        show(layout.panelInfo.getSnapshot().activePanelId === null ? selected?.sessionId : undefined)
//      也就是说「在屏会话」**只在对话占据中栏（activePanelId === null）时**才有值；
//   2. `sidebarRight.openTab()` 走 `require()`，拿不到在屏会话就直接抛
//      `sidebarRight: no session surface is mounted`；
//   3. `sidebar.panellist` 的每一行点击 = `layout.selectPanel(id)`，只会切 main 面板。
//
// 所以：**先让对话回到中栏（selectPanel(null)），再 openTab**。
// 顺序反了一定失败（这正是之前"点了没反应"的原因）。
//
// 打开路径：
//   · 主路径：侧栏图标自己接管点击（不切 main）→ openDock()；
//   · 兜底：万一点击没被接住、main 被切到我们的启动器 → 启动器把中栏还给对话 → openDock()；
//   · 两条路径最终都会：右栏出现论文 / 或弹出可见的错误卡片（绝不静默）。
import { useEffect } from 'react'
import { ReaderPane } from './ReaderPane'
import { PanelIcon } from './components/Icon'
import { ReaderAttachments } from './components/ReaderAttachments'
import { installNativeExplanation } from './explain'

export const TAB_ID = 'zr-reader'
export const TAB_KIND = 'zr-reader'
export const PANEL_LABEL = '论文阅读'

interface SlotsService {
  register(decl: Record<string, unknown>, component: unknown): () => void
  inject(name: string, callback: () => unknown): unknown
}

interface LayoutService {
  selectPanel(panelId: string | null): void
  panelInfo?: { getSnapshot?: () => { activePanelId?: string | null } }
}

interface SidebarRightService {
  openTab(kind: string, options?: Record<string, unknown>): void
}

interface TabsService {
  register(decl: Record<string, unknown>): () => void
}

interface PluginCtx {
  slots?: SlotsService
  layout?: LayoutService
  sidebarRight?: SidebarRightService
  sidebarRightTabs?: TabsService
  inject(services: string[], callback: (ctx: PluginCtx) => unknown): unknown
  effect(callback: () => unknown, label?: string): unknown
  get(name: string): unknown
}

/* ------------------------------------------------------------------ */
/* 运行时句柄                                                          */
/* ------------------------------------------------------------------ */

interface Bridge {
  right?: SidebarRightService
  layout?: LayoutService
  lastError?: string
  tabsReady?: boolean
  /** 重试次数上限（测试里调小） */
  retryLimit?: number
}

const bridge = (): Bridge => {
  const g = globalThis as Record<string, unknown>
  if (!g.__zrBridge) g.__zrBridge = {} as Bridge
  return g.__zrBridge as Bridge
}

/** 中栏当前是否就是对话（DSH 用 activePanelId === null 表示） */
export function conversationInMain(): boolean {
  try {
    const info = bridge().layout?.panelInfo?.getSnapshot?.()
    return (info?.activePanelId ?? null) === null
  } catch {
    return false
  }
}

/** 把中栏还给对话；这是 openTab 能成功的前提 */
export function restoreConversation(): void {
  try {
    bridge().layout?.selectPanel(null)
  } catch (error) {
    console.warn('[zr] 归还中栏失败:', error)
  }
}

/* ------------------------------------------------------------------ */
/* 可见的错误卡片（模块级，不随组件卸载消失）                            */
/* ------------------------------------------------------------------ */

let noticeEl: HTMLElement | null = null

function hideNotice(): void {
  noticeEl?.remove()
  noticeEl = null
}

function showNotice(message: string): void {
  hideNotice()
  const el = document.createElement('div')
  el.setAttribute('data-zr-notice', '')
  el.style.cssText = [
    'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147483000',
    'max-width:360px', 'background:#fff', 'color:#1f2328',
    'border:1px solid rgba(0,0,0,.12)', 'border-radius:10px',
    'box-shadow:0 12px 32px rgba(15,23,42,.18)', 'padding:12px 14px',
    'font:12.5px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif',
  ].join(';')

  const title = document.createElement('div')
  title.textContent = '论文阅读打不开右侧栏'
  title.style.cssText = 'font-weight:600;margin-bottom:6px'

  const body = document.createElement('div')
  body.textContent = message
  body.style.cssText = 'color:#b91c1c;word-break:break-word;margin-bottom:8px'

  const hint = document.createElement('div')
  hint.textContent = '右侧栏依附于会话：请先打开一个会话，或直接用右栏「+」菜单里的「论文阅读」。'
  hint.style.cssText = 'color:#6b7280;margin-bottom:10px'

  const row = document.createElement('div')
  row.style.cssText = 'display:flex;gap:6px;justify-content:flex-end'

  const retry = document.createElement('button')
  retry.textContent = '重试'
  retry.style.cssText = 'height:26px;padding:0 10px;border:none;border-radius:6px;background:#2563eb;color:#fff;cursor:pointer;font:inherit'
  retry.onclick = () => {
    hideNotice()
    openDock(0)
  }

  const close = document.createElement('button')
  close.textContent = '关闭'
  close.style.cssText = 'height:26px;padding:0 10px;border:1px solid rgba(0,0,0,.12);border-radius:6px;background:transparent;cursor:pointer;font:inherit'
  close.onclick = hideNotice

  row.append(retry, close)
  el.append(title, body, hint, row)
  document.body.append(el)
  noticeEl = el
  void message
}

/* ------------------------------------------------------------------ */
/* 打开右侧栏                                                          */
/* ------------------------------------------------------------------ */

/** 尝试打开；成功返回 true 并清掉错误 */
export function tryOpenReader(): boolean {
  const b = bridge()
  if (!b.right) {
    b.lastError = '当前会话没有 sidebarRight 服务'
    return false
  }
  try {
    b.right.openTab(TAB_KIND, { revealIfOpened: true })
    b.lastError = undefined
    hideNotice()
    return true
  } catch (error) {
    b.lastError = error instanceof Error ? error.message : String(error)
    return false
  }
}

/** 带重试的打开：先确保对话占着中栏（openTab 的前提），再打开 */
export function openDock(attempt = 0): void {
  const b = bridge()
  if (!conversationInMain()) restoreConversation()
  if (tryOpenReader()) return

  const limit = b.retryLimit ?? 24
  if (attempt >= limit) {
    console.warn('[zr] 打开右侧栏失败:', b.lastError)
    showNotice(`${b.lastError ?? '未知原因'}（已重试 ${attempt} 次）`)
    return
  }
  window.setTimeout(() => openDock(attempt + 1), 300)
}

/* ------------------------------------------------------------------ */
/* 侧栏图标                                                            */
/* ------------------------------------------------------------------ */

function PanelEntry(props: { size?: number; active?: boolean }) {
  return (
    <span
      className="zr-entry-icon"
      onClick={(event) => {
        // 不切 main：对话留在中间，「在屏会话」就一直有值
        event.preventDefault()
        event.stopPropagation()
        openDock()
      }}
    >
      <PanelIcon size={props.size ?? 16} active={props.active} />
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* 启动器（只在点击没被接住时才出现）                                    */
/* ------------------------------------------------------------------ */

function Launcher() {
  useEffect(() => {
    // 先把中栏还给对话，再打开；openDock 的重试是模块级的，不随本组件卸载而中断
    restoreConversation()
    openDock()
  }, [])

  return (
    <div className="zr-page zr-docked zr-launcher">
      <div className="zr-launcher-box">
        <PanelIcon size={28} active />
        <div className="zr-launcher-title">正在把论文阅读停靠到右侧栏…</div>
        <div className="zr-launcher-hint">对话会留在中间。若右侧栏没有出现，稍后这里会给出原因。</div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 注册                                                                */
/* ------------------------------------------------------------------ */

export const name = '@ggboy123/dsh-zotero-reader'
export const inject = ['slots', 'sidebarRight', 'sidebarRightTabs']

export function apply(ctx: PluginCtx): void {
  ctx.inject(['layout'], (pageCtx) => {
    const slots = pageCtx.slots
    const layout = pageCtx.layout
    const right = pageCtx.sidebarRight
    const tabs = pageCtx.sidebarRightTabs
    if (!slots) return undefined

    const b = bridge()
    b.right = right
    b.layout = layout

    const stops: Array<(() => void) | undefined> = []

    stops.push(installNativeExplanation(pageCtx))

    stops.push(slots.inject('conversation.input.attachments', () => slots.register({
      // DSH single slots render the LOWEST priority; the native rail uses 0.
      name: 'conversation.input.attachments', id: 'zr-reference-strips', priority: -1000,
    }, ReaderAttachments)) as () => void)

    // ① 右侧栏标签类型（field 形状照 DSH 自家浏览器；guide 让「+」菜单也能打开）
    if (tabs) {
      try {
        stops.push(
          ctx.effect(
            () =>
              tabs.register({
                id: TAB_ID,
                kind: TAB_KIND,
                multiple: false,
                priority: 'extension',
                title: () => PANEL_LABEL,
                guide: [
                  {
                    id: 'open',
                    order: 60,
                    title: () => PANEL_LABEL,
                    description: () => '阅读本地 Zotero 论文',
                  },
                ],
              }),
            'dsh-zotero-reader: tab type',
          ) as () => void,
        )
        b.tabsReady = true
      } catch (error) {
        b.tabsReady = false
        b.lastError = `注册标签类型失败：${error instanceof Error ? error.message : String(error)}`
        console.error('[zr]', b.lastError)
      }
    } else {
      b.tabsReady = false
      b.lastError = '没有 sidebarRightTabs 服务'
    }

    // ② 右侧栏标签内容
    stops.push(
      slots.inject('sidebar.right.pane.tab', () =>
        slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID }, ReaderPane),
      ) as () => void,
    )

    // ③ 左侧栏入口
    stops.push(
      slots.inject('sidebar.panellist', () =>
        slots.register({ name: 'sidebar.panellist', id: TAB_ID, order: 20, label: PANEL_LABEL }, PanelEntry),
      ) as () => void,
    )

    // ④ 启动器（兜底）
    stops.push(slots.inject('main', () => slots.register({ name: 'main', key: TAB_ID }, Launcher)) as () => void)

    ;(globalThis as Record<string, unknown>).__zrOpenReader = () => openDock()

    return () => {
      delete (globalThis as Record<string, unknown>).__zrOpenReader
      hideNotice()
      for (const stop of stops.reverse()) {
        try {
          stop?.()
        } catch {
          /* 卸载期忽略 */
        }
      }
    }
  })
}
