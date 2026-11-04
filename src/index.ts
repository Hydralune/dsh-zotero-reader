// dsh-zotero-reader — Cordis 插件壳。
// 壳保持薄：agent 循环与模型层交给 dsh 框架；本插件只提供
//   ① 文献库 + Zotero 读取 ② 阅读器静态资源 ③ 阅读器需要的 HTTP 路由。

import type { Context } from '@deepseek-ai/cordis'
import { registerRoutes, type PluginConfig } from './host.ts'

export const name = 'dsh-zotero-reader'

export function apply(ctx: Context, config: PluginConfig = {}) {
  // webServer/connection 是 web profile 的服务；sessionController 用来把划词问询
  // 直接注入 dsh 自己的对话，而不是插件自绘一个聊天框。
  ctx.inject(['webServer', 'connection', 'sessionController'], (rctx) => {
    registerRoutes(rctx, config)
    console.log('[dsh-zotero-reader] routes mounted at /lr-reader/*')
  })
}
