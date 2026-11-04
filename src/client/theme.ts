// theme.ts — 设计令牌 + 全局样式。
//
// 原则：一切颜色/间距都走 DSH 自己的主题变量（--dsw-alias-*），深色模式自动跟随，
// 不再像旧版那样写死 #f5f5f5 / #333。下面的 fallback 只用于变量缺失的极端情况。

export const CSS = String.raw`
.zr-page{
  --zr-bg: var(--dsw-alias-bg-base, #fff);
  --zr-surface: var(--dsw-alias-bg-layer-1, #fafafa);
  --zr-surface-2: var(--dsw-alias-bg-layer-2, #f2f3f5);
  --zr-overlay: var(--dsw-alias-bg-overlay, #fff);
  --zr-border: var(--dsw-alias-border-l1, rgba(0,0,0,.08));
  --zr-border-strong: var(--dsw-alias-border-l2, rgba(0,0,0,.16));
  --zr-text: var(--dsw-alias-label-primary, #1f2328);
  --zr-text-2: var(--dsw-alias-label-secondary, #6b7280);
  --zr-brand: var(--dsw-alias-brand-primary, #2563eb);
  --zr-danger: var(--dsw-alias-state-error-primary, #dc2626);
  --zr-ok: var(--dsw-alias-state-success-primary, #16a34a);
  --zr-warn: var(--dsw-alias-state-warn-primary, #d97706);
  --zr-side: var(--dsw-specific-sidebar-fill, #f7f7f8);
  --zr-radius: 9px;
  --zr-panel-radius: 14px;
  --zr-control: 30px;
  --zr-hover: color-mix(in srgb, var(--zr-text) 6%, transparent);
  --zr-selected: color-mix(in srgb, var(--zr-brand) 10%, var(--zr-bg));
  --zr-selected-line: color-mix(in srgb, var(--zr-brand) 30%, var(--zr-border));

  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--zr-bg);
  color: var(--zr-text);
  font: 13px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  overflow: hidden;
}

/* ---------- 顶栏 ---------- */
.zr-top{
  flex: none; display: flex; align-items: center; gap: 6px;
  height: 47px; padding: 0 12px;
  border-bottom: 1px solid var(--zr-border);
  background: var(--zr-bg);
}
/* ---------- 停靠布局（右侧栏） ---------- */
.zr-docked{ font-size: 12.5px; }
.zr-document-picker{ flex: 1; min-width: 0; display: flex; align-items: center; gap: 5px; }
.zr-quick-picker{ position: absolute; z-index: 65; top: 44px; left: 42px; width: min(440px, calc(100% - 54px));
  max-height: min(65vh, 480px); overflow: auto; padding: 8px; box-sizing: border-box;
  border: 1px solid var(--zr-border); border-radius: var(--zr-panel-radius); background: var(--zr-overlay); box-shadow: 0 8px 24px #15202e22; }
.zr-fit-control{ padding-inline: 6px; color: var(--zr-text-2); }
.zr-fit-control[aria-pressed="true"]{ color: var(--zr-text); background: var(--zr-hover); }
.zr-fit-control span{ font-size: 11px; }
.zr-txt-reference{ font-size: calc(14px * var(--zr-text-scale)); line-height: 1.65; text-align: start;
  padding-inline-start: 1.8em; text-indent: -1.8em; overflow-wrap: anywhere; }
.zr-pick{
  flex: 1; min-width: 0; justify-content: flex-start; gap: 6px;
  background: var(--zr-surface); border: 1px solid var(--zr-border);
  max-width: none; padding: 0 7px;
}
.zr-pick-title{
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-weight: 600; font-size: 12px;
}
.zr-page-no-lbl{ font-size: 11px; color: var(--zr-text-2); padding: 0 2px; }
.zr-toolbar{
  flex: none; display: flex; align-items: center; gap: 7px;
  padding: 5px 10px; border-bottom: 1px solid var(--zr-border);
  background: var(--zr-bg); overflow-x: auto;
}
.zr-toolbar-group{
  display: inline-flex; align-items: center; flex: none; gap: 2px; padding: 2px;
  border: 1px solid var(--zr-border); border-radius: calc(var(--zr-radius) + 3px);
  background: var(--zr-surface);
}
.zr-toolbar-group .zr-page-no-lbl{ padding-inline: 5px; white-space: nowrap; }
.zr-dock-body{ flex: 1; min-height: 0; display: flex; position: relative; background: var(--zr-surface-2); }

/* 抽屉：覆盖在画布上，不挤压阅读区 */
.zr-drawer{
  position: absolute; inset: 8px auto 8px 8px; z-index: 30; width: min(calc(100% - 16px), 308px);
  display: flex; flex-direction: column; min-height: 0;
  background: var(--zr-bg); border: 1px solid var(--zr-border); border-radius: var(--zr-panel-radius); overflow: hidden;
  box-shadow: 8px 0 24px rgba(15,23,42,.12);
  animation: zr-drawer-in .16s cubic-bezier(.16,1,.3,1) both;
}
@keyframes zr-drawer-in{ from{ opacity: 0; transform: translateX(-8px) } to{ opacity: 1; transform: none } }
.zr-drawer-tabs{
  flex: none; display: flex; align-items: center; gap: 3px;
  padding: 7px; border-bottom: 1px solid var(--zr-border);
}
.zr-entry-icon{ display: inline-flex; align-items: center; justify-content: center; }

/* 启动器：main 面板只做「打开右侧栏」这一件事 */
.zr-launcher{ align-items: center; justify-content: center; }
.zr-launcher-box{
  max-width: 420px; display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 24px; text-align: center;
}
.zr-launcher-title{ font-size: 14px; font-weight: 600; }
.zr-launcher-hint{ font-size: 12px; color: var(--zr-text-2); line-height: 1.7; }
.zr-launcher-err{
  font-size: 12px; color: var(--zr-danger);
  background: color-mix(in srgb, var(--zr-danger) 10%, transparent);
  border-radius: 6px; padding: 6px 10px; max-width: 100%; word-break: break-word;
}

/* ---------- 通用控件 ---------- */
.zr-btn{
  display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  box-sizing: border-box; min-height: var(--zr-control); padding: 0 9px; border-radius: var(--zr-radius);
  border: 1px solid transparent; background: transparent;
  color: var(--zr-text); font: inherit; font-size: 12.5px; cursor: pointer;
  transition: background-color .12s ease, color .12s ease;
}
.zr-btn:hover{ background: var(--zr-hover); border-color: var(--zr-border); }
.zr-btn:disabled{ opacity: .45; cursor: default; }
.zr-btn[data-active]{ background: var(--zr-selected); border-color: var(--zr-selected-line); color: var(--zr-brand); }
.zr-btn-icon{ width: var(--zr-control); height: var(--zr-control); flex: none; padding: 0; }
.zr-page :is(button, summary, select, a):focus-visible{ outline: 2px solid var(--zr-brand); outline-offset: 1px; }
.zr-page :is(.zr-btn, .zr-selbar-btn, summary) svg{ flex: none; }
.zr-btn-primary{
  background: var(--zr-brand); color: #fff; border-color: transparent;
}
.zr-btn-primary:hover{ filter: brightness(.95); background: var(--zr-brand); }

.zr-sep{ width: 1px; height: 16px; background: var(--zr-border); margin: 0 2px; flex: none; }
.zr-muted{ color: var(--zr-text-2); }
.zr-mono{ font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }

/* ---------- 空态 ---------- */
.zr-empty{
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; padding: 32px; color: var(--zr-text-2); text-align: center;
}
.zr-empty-title{ font-size: 14px; font-weight: 600; color: var(--zr-text); }

/* ---------- 左栏列表 ---------- */
.zr-left-tab{
  flex: 1; height: var(--zr-control); border: 1px solid transparent; background: transparent; cursor: pointer;
  border-radius: var(--zr-radius); color: var(--zr-text-2); font: inherit; font-size: 12px;
}
.zr-left-tab:hover{ background: var(--zr-hover); }
.zr-left-tab[data-active]{ background: var(--zr-selected); border-color: var(--zr-selected-line); color: var(--zr-text); font-weight: 600; }
.zr-list{ flex: 1; min-height: 0; overflow: auto; padding: 6px; }
.zr-library-upload{ display: flex; gap: 6px; padding: 0 8px 8px; }
.zr-library-upload select{ flex: 1; min-width: 0; }
.zr-library-status{ padding: 0 10px; margin: 3px 0 8px; color: var(--zr-text-2); font-size: 12px; }
.zr-library-folder > summary{
  display: flex; align-items: center; gap: 5px; min-height: var(--zr-control); list-style: none;
  cursor: pointer; padding: 3px 6px; border-radius: var(--zr-radius); font-weight: 600;
}
.zr-library-folder > summary::-webkit-details-marker{ display: none; }
.zr-library-folder > summary:hover{ background: var(--zr-hover); }
.zr-library-folder > summary > span{ min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zr-library-folder > summary small{
  margin-inline-start: auto; color: var(--zr-text-2); font-weight: 500; font-variant-numeric: tabular-nums;
  padding: 0 5px; background: var(--zr-surface-2); border-radius: 6px;
}
.zr-folder-caret{ color: var(--zr-text-2); }
.zr-library-folder[open] > summary .zr-folder-caret{ transform: rotate(90deg); }
.zr-library-branch .zr-item{ position: relative; padding-inline-start: 29px; }
.zr-library-file-icon{ position: absolute; inset-inline-start: 7px; top: 8px; color: var(--zr-text-2); }
.zr-library-branch{ margin-inline-start: 10px; padding-inline-start: 5px; border-inline-start: 1px solid var(--zr-border); }
.zr-group{
  font-size: 10.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
  color: var(--zr-text-2); padding: 8px 6px 4px;
}
.zr-item{
  display: block; width: 100%; text-align: left; border: 1px solid transparent; background: transparent;
  padding: 6px; border-radius: var(--zr-radius); cursor: pointer; color: inherit; font: inherit;
}
.zr-item:hover{ background: color-mix(in srgb, var(--zr-brand) 7%, transparent); }
.zr-item[data-active]{ background: var(--zr-selected); border-color: var(--zr-selected-line); }
.zr-item-t{
  font-size: 12.5px; font-weight: 600; line-height: 1.35;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.zr-item-m{ font-size: 11px; color: var(--zr-text-2); margin-top: 2px; }
.zr-search{
  flex: none; margin: 7px 8px; height: var(--zr-control); padding: 0 9px;
  border: 1px solid var(--zr-border); border-radius: var(--zr-radius);
  background: var(--zr-bg); color: var(--zr-text); font: inherit; font-size: 12.5px; outline: none;
}
.zr-page .zr-search:focus{ outline: none; border-color: var(--zr-selected-line); box-shadow: 0 0 0 2px var(--zr-selected); }

/* ---------- 右栏对话 ---------- */
.zr-input{
  width: 100%; min-height: 62px; max-height: 200px; resize: vertical;
  padding: 7px 9px; border: 1px solid var(--zr-border); border-radius: 8px;
  background: var(--zr-bg); color: var(--zr-text); font: inherit; font-size: 12.5px; outline: none;
}
.zr-input:focus{ border-color: var(--zr-brand); }
.zr-row{ display: flex; align-items: center; gap: 6px; }
.zr-row-end{ justify-content: flex-end; }

/* ---------- 划词浮层 ---------- */
.zr-selbar{
  position: fixed; z-index: 60; display: flex; align-items: stretch;
  padding: 4px; border-radius: var(--zr-panel-radius);
  background: var(--zr-overlay);
  border: 1px solid color-mix(in srgb, var(--zr-text) 10%, transparent);
  box-shadow: 0 12px 32px rgba(15,23,42,.18), 0 2px 8px rgba(15,23,42,.08);
  animation: zr-pop .14s cubic-bezier(.16,1,.3,1) both;
}
@keyframes zr-pop{ from{ opacity:0; transform: translateY(6px) scale(.97) } to{ opacity:1; transform:none } }
.zr-selbar-row{ display: flex; align-items: center; gap: 2px; height: 38px; }
.zr-selbar-btn{
  width: var(--zr-control); height: var(--zr-control); display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid transparent; border-radius: var(--zr-radius); background: transparent; color: var(--zr-text);
  cursor: pointer; transition: background-color .12s ease, color .12s ease, transform .1s ease;
}
.zr-selbar-btn:hover{ border-color: var(--zr-border); background: color-mix(in srgb, var(--zr-brand) 10%, transparent); color: var(--zr-brand); }
.zr-selbar-btn:active{ transform: scale(.94); }
.zr-selbar-btn[data-active]{ background: color-mix(in srgb, var(--zr-brand) 14%, transparent); }
.zr-selbar-sep{
  width: 1px; height: 18px; margin: 0 5px; flex: none;
  background: color-mix(in srgb, var(--zr-text) 12%, transparent);
}
.zr-selbar-color{ width: 30px; }
.zr-color-dot{
  width: 17px; height: 17px; border-radius: 50%;
  box-shadow: 0 0 0 1.5px var(--zr-overlay), 0 0 0 2.5px color-mix(in srgb, var(--zr-text) 18%, transparent);
}
.zr-selection-tools{
  box-sizing: border-box; padding: 4px; border-radius: 14px;
  box-shadow: 0 5px 18px rgba(15,23,42,.12), 0 1px 3px rgba(15,23,42,.08);
}
.zr-selection-tools .zr-selbar-row{ height: 30px; justify-content: space-between; gap: 0; }
.zr-selection-tools .zr-selbar-btn{ width: 30px; height: 30px; padding: 0; border-radius: 9px; }
.zr-selection-tools .zr-selbar-sep{ height: 13px; margin: 0 2px; }
.zr-selection-tools .zr-color-dot{ width: 12px; height: 12px; box-shadow: inset 0 0 0 1px rgba(0,0,0,.12); }
.zr-selbar-palette{
  display: flex; align-items: center; justify-content: space-between;
  gap: 6px; padding: 5px 8px 7px;
  border-top: 1px solid color-mix(in srgb, var(--zr-text) 8%, transparent);
}
.zr-swatch-btn{
  width: 22px; height: 22px; border-radius: 50%; border: none; cursor: pointer; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.14);
  transition: transform .12s cubic-bezier(.16,1,.3,1), box-shadow .12s ease;
}
.zr-swatch-btn:hover{ transform: scale(1.12); }
.zr-swatch-btn[data-active]{ box-shadow: 0 0 0 2px var(--zr-overlay), 0 0 0 3.5px var(--zr-brand); }

/* ---------- 提示 ---------- */
.zr-toast{
  position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%);
  padding: 7px 14px; border-radius: 8px; font-size: 12px; z-index: 80;
  background: rgba(17,24,39,.92); color: #fff; white-space: nowrap;
  animation: zr-pop .16s ease-out both;
}

/* ---------- PDF 画布 ---------- */
.zr-pdf-scroll{ flex: 1; min-height: 0; overflow: auto; position: relative; background: var(--zr-surface-2); }
.zr-pdf-stack{
  display: flex; flex-direction: column; align-items: center;
  gap: 12px; padding: 12px 0 48px;
}
.zr-page-box{
  position: relative; flex: none; background: #fff; overflow: hidden;
  border-radius: 2px;
  box-shadow: 0 1px 2px rgba(15,23,42,.14), 0 8px 22px rgba(15,23,42,.07);
}
.zr-pdf-scroll[data-capture-mode] .zr-page-box{ cursor: crosshair; touch-action: none; }
.zr-pdf-scroll[data-capture-mode] .textLayer{ pointer-events: none; user-select: none; }
.zr-capture-region{
  position: absolute; z-index: 4; box-sizing: border-box; pointer-events: none;
  border: 1px solid var(--zr-brand); background: color-mix(in srgb, var(--zr-brand) 12%, transparent);
}
.zr-text-capture-overlay{ position: fixed; z-index: 25; cursor: crosshair; touch-action: none; user-select: none; }
.zr-quote-preview-host{ min-width: 0; flex: 0 0 auto; width: 100%; box-sizing: border-box; padding: 6px 8px; }
.zr-quote-preview{ display: flex; align-items: center; gap: 8px; min-width: 0; padding: 8px 10px; border: 1px dashed #a0a0a050; border-radius: 12px; color: #888; background: #88888809; font: 12px/1.45 'Segoe UI','Microsoft YaHei',sans-serif; }
.zr-quote-preview > svg{ flex: none; width: 18px; height: 18px; }
.zr-quote-preview-body{ display: grid; flex: 1; min-width: 0; gap: 3px; }
.zr-quote-preview-body > *{ overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zr-quote-preview-body small{ opacity: .8; font-size: 11px; }
.zr-quote-preview-button{ display: grid; place-items: center; flex: none; width: 28px; height: 28px; padding: 4px; border: 1px solid #88888830; border-radius: 8px; color: inherit; background: transparent; cursor: pointer; }
.zr-quote-preview-button:hover{ color: #d47654; background: #d4765410; }
.zr-quote-preview-button svg{ width: 18px; height: 18px; }
.zr-quote-confirmed-list{ display: grid; gap: 6px; padding: 6px 8px; min-width: 0; }
.zr-quote-confirmed{ color: inherit; border-style: solid; background: #88888808; }
.zr-quote-confirmed > svg{ color: #d47654; }
.zr-quote-confirmed[data-status="error"]{ border-color: #c33; }
.zr-quote-preview-button:disabled{ opacity: .5; cursor: wait; }
.zr-txt-crop.zr-media-selected{ outline: 2px solid var(--zr-brand); outline-offset: 3px; border-radius: 8px; }
.zr-media-menu{ position: fixed; z-index: 80; width: 176px; padding: 5px; border: 1px solid var(--zr-border); border-radius: 12px; background: var(--zr-overlay); box-shadow: 0 8px 28px #15202e22; }
.zr-media-menu button{ width: 100%; display: flex; align-items: center; gap: 9px; padding: 8px; border: 0; border-radius: 8px; color: var(--zr-text); background: transparent; text-align: start; cursor: pointer; font: inherit; font-size: 13px; line-height: 1.4; }
.zr-media-menu button:hover,.zr-media-menu button:focus-visible{ background: var(--zr-surface); outline: none; }
.zr-media-menu button:disabled{ opacity: .5; cursor: wait; }
.zr-media-menu svg{ width: 18px; height: 18px; flex: none; }
.zr-media-menu small{ margin-inline-start: auto; font-size: 10px; color: var(--zr-text-2); }
/* Claude-style's synthetic hero placeholder is pinned to the card's top even
   when attachments occupy that space. Hide hints while a reference is present;
   leave the editor's accessible label and the user's draft untouched. */
[data-composer-card]:is([data-has-attachments="true"],:has(.zr-quote-confirmed-list),:has(.zr-quote-preview-host),:has([data-slot="conversation.input.attachments"] [role="group"])) :is([data-dsh-synthetic-placeholder],[data-composer-placeholder]){ display: none !important; }
[data-composer-card] [data-input-scroll] > :has(> [role="textbox"]){ position: relative !important; }
.zr-page-canvas{ display: block; }
.zr-page-no{
  position: absolute; right: 6px; bottom: 4px; font-size: 10px;
  color: rgba(15,23,42,.3); pointer-events: none; user-select: none;
}
.zr-page-box.zr-flash{ animation: zr-flash .9s ease-out both; }
@keyframes zr-flash{
  0%{ box-shadow: 0 0 0 3px rgba(37,99,235,.5), 0 8px 22px rgba(15,23,42,.07) }
  100%{ box-shadow: 0 1px 2px rgba(15,23,42,.14), 0 8px 22px rgba(15,23,42,.07) }
}
.zr-pdf-loading{
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  color: var(--zr-text-2); font-size: 12.5px;
}

/* ---------- pdf.js 文本层（取自 pdf_viewer.css 的必要子集） ---------- */
.zr-page-box .textLayer{
  --scale-round-x: 1px;
  --scale-round-y: 1px;
  --min-font-size: 1;
  --min-font-size-inv: calc(1 / var(--min-font-size));
  --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));

  position: absolute; inset: 0; z-index: 0; overflow: clip;
  text-align: initial; line-height: 1; letter-spacing: normal; word-spacing: normal;
  opacity: 1; transform-origin: 0 0; caret-color: CanvasText;
  -webkit-text-size-adjust: none; text-size-adjust: none;
  forced-color-adjust: none; color-scheme: only light;
}
.zr-page-box .textLayer :is(span, br){
  position: absolute; color: transparent; white-space: pre; cursor: text;
  transform-origin: 0 0; user-select: text;
  line-height: 1 !important;
  display: inline-block; vertical-align: baseline;
}
.zr-page-box .textLayer > :not(.markedContent),
.zr-page-box .textLayer .markedContent span:not(.markedContent){
  z-index: 1;
  --font-height: 0;
  --scale-x: 1;
  --rotate: 0deg;
  font-size: calc(var(--text-scale-factor) * var(--font-height));
  transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
}
.zr-page-box .textLayer .markedContent{ display: contents; }
.zr-page-box .textLayer::selection,
.zr-page-box .textLayer ::selection{ background: transparent; color: transparent; }
.zr-selection-preview{
  position: absolute; inset: 0; width: 100%; height: 100%; z-index: 2;
  pointer-events: none; fill: rgba(62,142,228,.23);
}
.zr-page-box .textLayer span.zr-hit{
  background: rgba(255,214,0,.45);
  border-radius: 2px;
}

/* ---------- 缩略图 ---------- */
.zr-thumbs{
  flex: 1; min-height: 0; overflow: auto; padding: 8px;
  display: flex; flex-direction: column; gap: 8px; align-items: center;
}
.zr-thumb{
  position: relative; border: 2px solid transparent; border-radius: 4px;
  background: #fff; padding: 0; cursor: pointer; line-height: 0;
  box-shadow: 0 1px 3px rgba(15,23,42,.14); overflow: hidden;
}
.zr-thumb canvas{ display: block; }
.zr-thumb span{
  position: absolute; left: 0; right: 0; bottom: 0; font-size: 10px; line-height: 16px;
  color: #fff; background: rgba(15,23,42,.55); text-align: center;
}
.zr-thumb[data-active]{ border-color: var(--zr-brand); }
.zr-thumb:hover{ border-color: color-mix(in srgb, var(--zr-brand) 55%, transparent); }

/* ---------- 目录 ---------- */
.zr-outline{ flex: 1; min-height: 0; overflow: auto; padding: 6px 4px 12px; }
.zr-outline-row{
  display: flex; align-items: center; gap: 2px; border-radius: 5px; padding-right: 4px;
}
.zr-outline-row:hover{ background: color-mix(in srgb, var(--zr-brand) 7%, transparent); }
.zr-outline-row[data-active]{ background: color-mix(in srgb, var(--zr-brand) 14%, transparent); }
.zr-outline-toggle{
  width: 14px; height: 22px; flex: none; border: none; background: transparent;
  color: var(--zr-text-2); cursor: pointer; font-size: 10px; padding: 0;
}
.zr-outline-title{
  flex: 1; min-width: 0; text-align: left; border: none; background: transparent;
  color: inherit; font: inherit; font-size: 12.5px; padding: 3px 2px; cursor: pointer;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.zr-outline-page{ flex: none; font-size: 10.5px; color: var(--zr-text-2); }

/* ---------- 搜索条 ---------- */
.zr-findbar{
  flex: none; display: flex; align-items: center; gap: 6px;
  padding: 6px 10px; border-bottom: 1px solid var(--zr-border); background: var(--zr-bg);
}
.zr-findbar input{
  flex: 1; height: 26px; padding: 0 9px; border-radius: 6px;
  border: 1px solid var(--zr-border); background: var(--zr-bg); color: var(--zr-text);
  font: inherit; font-size: 12.5px; outline: none;
}
.zr-findbar input:focus{ border-color: var(--zr-brand); }
.zr-find-count{ font-size: 11.5px; color: var(--zr-text-2); white-space: nowrap; }

/* ---------- 高亮层 ---------- */
.zr-hl-layer{ position: absolute; inset: 0; z-index: 1; pointer-events: none; }
.zr-hl-group{ opacity: .34; mix-blend-mode: multiply; }
/* 高亮块必须让路：pointer-events: auto 会把鼠标从文字层上抢走，
   一旦某段被高亮过就再也划不动那一行了。点击命中改由 PdfViewer 在 mouseup 里做几何判定。 */
.zr-hl{
  position: absolute; pointer-events: none; border-radius: 1px;
}
.zr-hl[data-kind="underline"]{ background: transparent; }
.zr-hl[data-active]{ outline: 1.5px solid var(--zr-brand); outline-offset: 1px; }

/* ---------- AI 对话 ---------- */
.zr-chip{
  border: 1px solid var(--zr-border); background: var(--zr-surface);
  color: var(--zr-text); font: inherit; font-size: 11.5px;
  padding: 5px 9px; border-radius: 999px; cursor: pointer;
}
.zr-chip:hover:not(:disabled){ border-color: var(--zr-brand); color: var(--zr-brand); }
.zr-chip:disabled{ opacity: .5; cursor: default; }
 }

/* ---------- 笔记列表 ---------- */
.zr-notes{ flex: 1; min-height: 0; overflow: auto; padding: 6px; display: flex; flex-direction: column; gap: 6px; }
.zr-note{
  border: 1px solid var(--zr-border); border-radius: 7px; padding: 6px 8px;
  background: var(--zr-bg); cursor: pointer;
}
.zr-note:hover{ border-color: var(--zr-brand); }
.zr-note[data-active]{ border-color: var(--zr-brand); box-shadow: 0 0 0 2px color-mix(in srgb, var(--zr-brand) 18%, transparent); }
.zr-note-head{ display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--zr-text-2); }
.zr-note-dot{ width: 9px; height: 9px; border-radius: 50%; flex: none; }
.zr-note-text{
  font-size: 12px; margin-top: 3px; line-height: 1.5;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.zr-note-actions{ margin-left: auto; display: flex; gap: 2px; }

/* ---------- 顶栏分段控件 ---------- */
.zr-seg{
  display: inline-flex; padding: 2px; gap: 2px; border-radius: 7px;
  background: var(--zr-surface-2);
}
.zr-seg-btn{
  height: 22px; padding: 0 9px; border: none; border-radius: 5px; background: transparent;
  color: var(--zr-text-2); font: inherit; font-size: 12px; cursor: pointer;
}
.zr-seg-btn[data-active]{ background: var(--zr-bg); color: var(--zr-text); font-weight: 600; box-shadow: 0 1px 2px rgba(15,23,42,.12); }

/* ---------- 翻译菜单 ---------- */
.zr-menu{
  position: absolute; top: 46px; right: 10px; z-index: 70; width: 320px;
  background: var(--zr-overlay); border: 1px solid var(--zr-border); border-radius: 10px;
  box-shadow: 0 14px 34px rgba(15,23,42,.18); overflow: hidden;
}
.zr-menu-head{
  display: flex; align-items: center; gap: 6px; padding: 8px 10px;
  border-bottom: 1px solid var(--zr-border); font-size: 12.5px; font-weight: 600;
}
.zr-menu-body{ padding: 10px; }
.zr-progress{ height: 5px; border-radius: 3px; background: var(--zr-surface-2); overflow: hidden; }
.zr-progress-fill{ height: 100%; background: var(--zr-brand); transition: width .4s ease; }
.zr-chip[data-active]{ border-color: var(--zr-brand); color: var(--zr-brand); }

/* ---------- 文本视图 ---------- */
.zr-textwrap{ --zr-text-scale: 1; container-type: inline-size; flex: 1; min-height: 0; min-width: 0; display: flex; flex-direction: column; background: var(--zr-bg); }
.zr-textbar{
  display: flex; flex: none; flex-wrap: wrap; align-items: center; gap: 8px 14px;
  padding: 8px 14px; border-bottom: 1px solid var(--zr-border);
}
.zr-txt-source{ font-size: 12px; font-weight: 650; }
.zr-txt-pages,.zr-text-size{ display: flex; align-items: center; flex: none; gap: 1px; padding: 2px;
  border: 1px solid var(--zr-border); border-radius: calc(var(--zr-radius) + 3px); background: var(--zr-surface); }
.zr-text-size-value{ min-width: 46px; padding-inline: 4px; font-variant-numeric: tabular-nums; }
.zr-engine-control{ position: relative; }
.zr-engine-menu{
  position: absolute; right: 0; top: calc(100% + 7px); z-index: 55; width: min(270px,calc(100vw - 24px));
  padding: 8px; border: 1px solid var(--zr-border); border-radius: var(--zr-panel-radius);
  background: var(--zr-overlay); box-shadow: 0 8px 22px #15202e20;
}
.zr-engine-menu > .zr-btn{ display: flex; width: 100%; justify-content: flex-start; }
.zr-engine-progress{ margin-top: 6px; padding: 7px; border-top: 1px solid var(--zr-border); color: var(--zr-text-2); }
.zr-engine-progress span{ display: block; font-size: 12px; }
.zr-parse-status{ display: flex; flex: none; align-items: center; gap: 7px; margin: 6px 10px; padding: 3px 7px;
  border: 1px solid var(--zr-border); border-radius: var(--zr-radius); background: var(--zr-surface); }
.zr-parse-status > span{ flex: 1; min-width: 0; max-height: 3em; overflow: auto; font-size: 12px; overflow-wrap: anywhere; }
.zr-txt-actions{ display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.zr-txt-actions{ margin-inline-start: auto; }
.zr-txt-select{
  height: var(--zr-control); border: 1px solid var(--zr-border); border-radius: var(--zr-radius); padding-inline: 7px;
  background: var(--zr-bg); color: var(--zr-text); font: inherit; font-size: 12px;
}
.zr-txt-layout{ display: grid; grid-template-columns: auto minmax(0,1fr); flex: 1; min-height: 0; }
.zr-txt-outline{
  box-sizing: border-box; width: clamp(136px, 21vw, 235px); overflow: auto; padding: 18px 10px;
  border-inline-end: 1px solid var(--zr-border); background: var(--zr-surface);
}
.zr-txt-layout[data-outline-hidden]{ grid-template-columns: minmax(0,1fr); grid-template-rows: minmax(0,1fr); }
.zr-txt-layout[data-outline-hidden] .zr-textscroll{ grid-column: 1; }
.zr-txt-outline-label{ margin: 0 8px 10px; color: var(--zr-text-2); font-size: 11px; font-weight: 650; letter-spacing: .09em; }
.zr-txt-outline button{
  width: 100%; display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
  padding: 7px 6px; border: 0; border-radius: 5px; background: transparent;
  color: var(--zr-text); font: inherit; font-size: 12px; text-align: start; cursor: pointer;
}
.zr-txt-outline button span{ overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zr-txt-outline button small{ color: var(--zr-text-2); font-variant-numeric: tabular-nums; }
.zr-txt-outline button:hover,.zr-txt-outline button[aria-current]{ background: color-mix(in srgb, var(--zr-brand) 9%, transparent); }
.zr-textscroll{ grid-column: 2; min-width: 0; overflow: auto; padding: 26px 0 72px; }
.zr-txt-page{ max-width: 720px; margin: 0 auto 48px; scroll-margin-top: 14px; padding: 0 clamp(16px,4vw,54px); }
.zr-txt-page-no{
  display: flex; gap: 12px; align-items: baseline; margin: 0 0 28px; padding-bottom: 10px;
  color: var(--zr-text-2); font-size: 11px; border-bottom: 1px solid var(--zr-border);
}
.zr-txt-page-no span{ overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zr-txt-pair{ margin: 0 0 1.25rem; scroll-margin-top: 16px; min-width: 0; }
.zr-txt-block{ margin: 0; overflow-wrap: anywhere; }
.zr-txt-text,.zr-txt-list,.zr-txt-equation{
  font: calc(16px * var(--zr-text-scale))/1.68 'Source Serif 4', Georgia, 'Noto Serif CJK SC', 'SimSun', serif;
}
.zr-txt-list{ padding-inline-start: 1.35em; }
.zr-txt-block code,.zr-txt-byline code{ font: .88em/1.5 Consolas, monospace; background: var(--zr-surface); border: 1px solid var(--zr-border); border-radius: 4px; padding: .05em .25em; overflow-wrap: anywhere; }
.zr-txt-block a{ color: var(--zr-accent); text-decoration: underline; text-underline-offset: .15em; overflow-wrap: anywhere; }
.zr-txt-title{
  font: 650 calc(19px * var(--zr-text-scale))/1.35 'Segoe UI','Microsoft YaHei',sans-serif;
  letter-spacing: -.012em; padding-top: .55em; text-wrap: pretty;
}
.zr-txt-pair[data-role="document-title"] .zr-txt-title{
  font: 650 calc(clamp(23px, 4cqi, 34px) * var(--zr-text-scale))/1.18 'Source Serif 4', Georgia, 'Noto Serif CJK SC', serif;
  letter-spacing: -.025em; padding: 0; margin-bottom: 12px;
}
.zr-txt-byline{
  margin: 0; padding-block: 4px 15px; border-bottom: 1px solid var(--zr-border);
  color: var(--zr-text-2); font: calc(12px * var(--zr-text-scale))/1.65 'Segoe UI', 'Microsoft YaHei', sans-serif;
}
.zr-txt-text,.zr-txt-list,.zr-txt-byline{
  text-align: justify; text-align-last: start; text-justify: inter-word; overflow-wrap: break-word;
}
.zr-txt-pair[data-located]{ position: relative; }
.zr-txt-pair[data-located]::after{
  content: ''; position: absolute; inset: -4px -6px; pointer-events: none;
  background: color-mix(in srgb, var(--zr-brand) 9%, transparent);
  border-inline-start: 2px solid var(--zr-brand); border-radius: 3px;
  animation: zr-location-fade .5s ease-out both;
}
.zr-pdf-locator{
  position: absolute; z-index: 2; pointer-events: none; box-sizing: border-box;
  border: 1px solid #b66a26; border-radius: 3px; background: #f9bf6729;
  animation: zr-location-fade .5s ease-out both;
}
@keyframes zr-location-fade{ from{ opacity: 1; } to{ opacity: 0; } }
@media (prefers-reduced-motion: reduce){
  .zr-txt-pair[data-located]::after,.zr-pdf-locator{ animation-timing-function: step-end; }
}
.zr-text-tools{ gap: 4px; }
.zr-text-result{ width: min(320px, calc(100vw - 16px)); max-height: 160px; overflow: auto; padding: 9px;
  gap: 8px; font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere; }
.zr-text-result > div{ flex: 1; min-width: 0; }
.zr-txt-pair ::selection{ background: #3e8ee438; }

.zr-txt-h1{ font-size: calc(21px * var(--zr-text-scale)); }
.zr-txt-h2{ font-size: calc(18px * var(--zr-text-scale)); }
.zr-txt-h3,.zr-txt-h4{ font-size: calc(16px * var(--zr-text-scale)); }
.zr-txt-caption,.zr-txt-figure{ color: var(--zr-text-2); font-size: calc(12px * var(--zr-text-scale)); line-height: 1.65; }
.zr-txt-figure{ display: inline-flex; align-items: center; gap: 6px; }
.zr-txt-equation,.zr-txt-table{ overflow: auto; }
.zr-txt-table{ padding: 8px 12px; background: var(--zr-surface); font: calc(12px * var(--zr-text-scale))/1.65 'Segoe UI', sans-serif; }
.zr-txt-table table{ width: max-content; min-width: 100%; border-collapse: collapse; text-align: start; }
.zr-txt-table :is(th,td){ padding: 5px 8px; border-bottom: 1px solid var(--zr-border); text-align: start; white-space: nowrap; overflow-wrap: normal; }
.zr-txt-table pre{ margin: 0; white-space: pre-wrap; }
.zr-txt-crop{
  display: block; width: 100%; padding: 0; border: 1px solid var(--zr-border);
  border-radius: 5px; overflow: hidden; cursor: zoom-in; background: #fff;
}
.zr-txt-crop canvas{ display: block; width: 100%; height: auto; }
.zr-txt-crop-equation{ width: min(100%, 440px); margin-inline: auto; }
.zr-txt-translation{
  margin-top: 7px; padding: 1px 0 1px 13px; border-inline-start: 2px solid var(--zr-border-strong);
  color: var(--zr-text-2); font: calc(15px * var(--zr-text-scale))/1.85 'Noto Serif CJK SC','Source Han Serif SC','SimSun',serif;
  white-space: pre-line; overflow-wrap: break-word; text-align: justify; text-align-last: start;
}
.zr-txt-title + .zr-txt-translation{ font-weight: 650; }
.zr-txt-status{ color: var(--zr-text-2); font-size: 12px; margin-bottom: 16px; }
.zr-txt-status .zr-btn{ margin-inline-start: 8px; }
.zr-textwrap :focus-visible{ outline: 2px solid var(--zr-brand); outline-offset: 1px; }
@container (max-width: 600px){
  .zr-txt-layout{ grid-template-columns: minmax(0,1fr); grid-template-rows: auto minmax(0,1fr); }
  .zr-txt-outline{ width: auto; max-height: 110px; padding-block: 8px; border-inline-end: 0; border-bottom: 1px solid var(--zr-border); }
  .zr-textscroll{ grid-column: 1; }
  .zr-txt-actions{ margin-inline-start: 0; }
}

/* ---------- 文本视图 → PDF 的定位闪烁 ---------- */
.zr-flash-rect{
  position: absolute; z-index: 3; pointer-events: none; border-radius: 2px;
  background: color-mix(in srgb, var(--zr-brand) 22%, transparent);
  box-shadow: 0 0 0 2px var(--zr-brand);
  animation: zr-flash-rect 1.4s ease-out both;
}
/* ---------- 高亮浮层里的原文 ---------- */
.zr-mark-text{
  font-size: 12px; line-height: 1.6; max-height: 132px; overflow: auto;
  white-space: pre-wrap; word-break: break-word;
  background: var(--zr-surface); border-radius: 6px; padding: 6px 8px;
}

/* ---------- 可访问性：键盘焦点 ---------- */
.zr-page :is(button, a, input, textarea, select):focus-visible{
  outline: 2px solid var(--zr-brand);
  outline-offset: 1px;
}
.zr-page ::-webkit-scrollbar{ width: 10px; height: 10px; }
.zr-page ::-webkit-scrollbar-thumb{
  background: color-mix(in srgb, var(--zr-text-2) 28%, transparent);
  border-radius: 6px; border: 2px solid transparent; background-clip: content-box;
}
.zr-page ::-webkit-scrollbar-thumb:hover{ background: color-mix(in srgb, var(--zr-text-2) 46%, transparent); background-clip: content-box; }

.zr-setup-shade{ position: absolute; inset: 0; z-index: 85; display: grid; place-items: center; padding: 12px; background: #15202e55; }
.zr-setup{ box-sizing: border-box; width: min(100%, 500px); max-height: 100%; overflow: auto; padding: 16px;
  background: var(--zr-bg); border: 1px solid var(--zr-border); border-radius: var(--zr-panel-radius); }
.zr-setup h2{ margin: 0; font-size: 17px; }
.zr-setup p{ margin: 8px 0; color: var(--zr-text-2); }
.zr-setup-status,.zr-setup-fields{ display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 7px; margin: 10px 0; }
.zr-setup-status span{ background: var(--zr-surface); padding: 7px; border: 1px solid var(--zr-border); border-radius: var(--zr-radius); }
.zr-setup-status strong{ display: block; }
.zr-setup-fields label{ display: grid; gap: 4px; min-width: 0; }
.zr-setup input{ min-width: 0; padding: 5px 7px; border: 1px solid var(--zr-border); border-radius: var(--zr-radius); background: var(--zr-bg); color: var(--zr-text); }
.zr-setup summary{ cursor: pointer; }
.zr-setup pre{ white-space: pre-wrap; overflow-wrap: anywhere; }
.zr-setup code{ overflow-wrap: anywhere; }
.zr-setup footer{ margin-top: 10px; }
`

let installed = false
/** 幂等注入样式（DSH 里插件可能被重载多次） */
export function installStyles(doc: Document = document): void {
  if (installed && doc.getElementById('zr-style')) return
  const el = doc.createElement('style')
  el.id = 'zr-style'
  el.textContent = CSS
  doc.head.appendChild(el)
  installed = true
}
