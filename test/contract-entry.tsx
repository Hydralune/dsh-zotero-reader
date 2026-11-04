// contract-entry.tsx — 插件契约测试：跑真实 apply()，用假 ctx 抓注册内容，再真的渲染并点击。
//
// 验的是三条「一旦不成立就白屏/没反应」的假设：
//   A. 注册形状对：标签类型（含 guide）、pane 内容、侧栏入口、启动器都在；
//   B. 点侧栏图标 → 真的调了 sidebarRight.openTab('zr-reader')；
//   C. 启动器：openTab 成功 → 立刻把 main 切回 conversation；openTab 失败 → **页面显示错误**，
//      而不是静默什么都不发生（这正是用户遇到的"点了没反应"）。
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createElement } from 'react'
import { apply } from '../src/client/plugin'

interface Registered {
  slot: string
  decl: Record<string, unknown>
  component: unknown
}

const calls = {
  openTab: [] as string[],
  selectPanel: [] as string[],
  outerClicks: 0,
  registers: [] as string[],
}

const registered: Registered[] = []
let tabsRegistered: Record<string, unknown> | null = null

let activePanelId: string | null = null
const layout = {
  selectPanel: (id: string | null) => {
    calls.selectPanel.push(String(id))
    activePanelId = id
  },
  panelInfo: { getSnapshot: () => ({ activePanelId }) },
  toggleSidebar: () => {},
  openRightbar: () => {},
  closeRightbar: () => {},
  beginNavigation: () => new AbortController().signal,
}

let rightImpl: { openTab: (kind: string) => void } = {
  openTab: (kind: string) => {
    calls.openTab.push(kind)
  },
}

const fakeCtx = {
  slots: {
    register: (decl: Record<string, unknown>, component: unknown) => {
      registered.push({ slot: String(decl.name), decl, component })
      calls.registers.push(String(decl.name))
      return () => {}
    },
    inject: (_name: string, callback: () => unknown) => {
      callback()
      return () => {}
    },
  },
  layout,
  get sidebarRight() {
    return rightImpl
  },
  sidebarRightTabs: {
    register: (decl: Record<string, unknown>) => {
      tabsRegistered = decl
      return () => {}
    },
  },
  inject: (_services: string[], callback: (ctx: unknown) => unknown) => {
    callback(fakeCtx)
    return () => {}
  },
  effect: (callback: () => unknown) => callback(),
  get: (key: string) => (key === 'layout' ? layout : key === 'sidebarRight' ? rightImpl : undefined),
}

apply(fakeCtx as never)

const results: Array<{ name: string; ok: boolean; detail?: string }> = []
const check = (name: string, ok: boolean, detail?: string) => {
  results.push({ name, ok, detail: detail ?? '' })
}

const find = (slot: string) => registered.filter((r) => r.slot === slot)

/* ---------------- A. 注册形状 ---------------- */
check('注册了标签类型', !!tabsRegistered, JSON.stringify(tabsRegistered))
check('标签类型 id/kind 一致', tabsRegistered?.id === 'zr-reader' && tabsRegistered?.kind === 'zr-reader')
check('标签标题为「论文阅读」', typeof tabsRegistered?.title === 'function' && (tabsRegistered.title as () => string)() === '论文阅读')
check('带 guide 条目（右栏「+」菜单也能打开）', Array.isArray(tabsRegistered?.guide) && (tabsRegistered?.guide as unknown[]).length === 1)
check('注册了 sidebar.right.pane.tab', find('sidebar.right.pane.tab').length === 1)
check('pane key 与 kind 一致', find('sidebar.right.pane.tab')[0]?.decl.key === 'zr-reader')
check('注册了 sidebar.panellist 入口', find('sidebar.panellist').length === 1)
check('入口 label/order 正确', find('sidebar.panellist')[0]?.decl.label === '论文阅读' && find('sidebar.panellist')[0]?.decl.order === 20)
check('注册了 main 启动器', find('main').length === 1 && find('main')[0]?.decl.key === 'zr-reader')

const IconEntry = find('sidebar.panellist')[0]?.component as ((p: { size?: number; active?: boolean }) => JSX.Element) | undefined
const Launcher = find('main')[0]?.component as (() => JSX.Element) | undefined

/* ---------------- B/C. 渲染与点击 ---------------- */
function Harness() {
  const [stage, setStage] = useState<'icon' | 'launcher-ok' | 'launcher-fail'>('icon')

  // B：图标点击
  useEffect(() => {
    if (stage !== 'icon' || !IconEntry) return
    const host = document.getElementById('p-icon')
    if (!host) return
    const root = createRoot(host)
    root.render(
      createElement(
        'button',
        {
          type: 'button',
          onClick: () => {
            calls.outerClicks += 1
            layout.selectPanel('zr-reader')
          },
        },
        createElement(IconEntry, { size: 16, active: false }),
      ),
    )
    const timer = window.setTimeout(() => {
      const inner = document.querySelector('#p-icon .zr-entry-icon') as HTMLElement | null
      check('图标渲染了 .zr-entry-icon', !!inner)
      inner?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      window.setTimeout(() => {
        check('点图标调用了 openTab("zr-reader")', calls.openTab.includes('zr-reader'), JSON.stringify(calls.openTab))
        check('点图标没有触发外层 selectPanel（对话不被抢）', calls.outerClicks === 0 && calls.selectPanel.length === 0)
        setStage('launcher-ok')
      }, 80)
    }, 120)
    return () => {
      window.clearTimeout(timer)
      root.unmount()
    }
  }, [stage])

  // C1：启动器成功 → 打开右栏 + 把 main 还给对话
  useEffect(() => {
    if (stage !== 'launcher-ok' || !Launcher) return
    const host = document.getElementById('p-launcher')
    if (!host) return
    const before = { tabs: calls.openTab.length, panels: calls.selectPanel.length }
    const root = createRoot(host)
    root.render(createElement(Launcher))
    const timer = window.setTimeout(() => {
      check(
        '启动器打开右侧栏',
        calls.openTab.length > before.tabs && calls.openTab[calls.openTab.length - 1] === 'zr-reader',
        JSON.stringify(calls.openTab),
      )
      check(
        '启动器先把中栏还给对话（selectPanel(null)）',
        calls.selectPanel.slice(before.panels).includes('null'),
        JSON.stringify(calls.selectPanel.slice(before.panels)),
      )
      setStage('launcher-fail')
    }, 150)
    return () => {
      window.clearTimeout(timer)
      root.unmount()
    }
  }, [stage])

  // C2：openTab 抛错 → 页面必须显示错误（不许静默）
  useEffect(() => {
    if (stage !== 'launcher-fail' || !Launcher) return
    // 注意：bridge 里存的是同一个对象引用，必须原地改方法（换对象是无效的）
    rightImpl.openTab = () => {
      throw new Error('sidebarRight: no session surface is mounted')
    }
    const g = window as unknown as { __zrBridge?: { retryLimit?: number } }
    if (g.__zrBridge) g.__zrBridge.retryLimit = 0
    const host = document.getElementById('p-fail')
    if (!host) return
    const root = createRoot(host)
    root.render(createElement(Launcher))
    const timer = window.setTimeout(() => {
      const notice = document.querySelector('[data-zr-notice]') as HTMLElement | null
      const text = notice?.textContent ?? ''
      check('失败时弹出可见错误卡片（不再静默）', !!notice, text.slice(0, 80))
      check('卡片里是真实原因', text.includes('no session surface is mounted'), text.slice(0, 120))
      check('卡片提供重试', text.includes('重试'))
      ;(window as unknown as Record<string, unknown>).__contractResult = {
        passed: results.filter((r) => r.ok).length,
        total: results.length,
        failed: results.filter((r) => !r.ok),
        registered: calls.registers,
      }
    }, 200)
    return () => {
      window.clearTimeout(timer)
      root.unmount()
    }
  }, [stage])

  return (
    <div>
      <div id="p-icon" />
      <div id="p-launcher" />
      <div id="p-fail" />
    </div>
  )
}

const el = document.getElementById('root')
if (el) createRoot(el).render(<Harness />)
