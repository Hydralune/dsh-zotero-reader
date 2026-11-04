import { createElement, useEffect, useMemo, useRef, type ReactNode } from 'react'
import MarkdownIt, { type Token } from 'markdown-it'

declare global {
  interface Window {
    katex?: { render(tex: string, el: HTMLElement, options?: Record<string, unknown>): void }
  }
}

/* ---------------- KaTeX（懒加载，仅在有 $...$ 时才拉） ---------------- */

let katexPromise: Promise<void> | null = null
function loadKatex(): Promise<void> {
  if (window.katex) return Promise.resolve()
  if (!katexPromise) {
    katexPromise = new Promise((resolve) => {
      const css = document.createElement('link')
      css.rel = 'stylesheet'
      css.href = '/lr-reader/vendor/katex.min.css'
      document.head.appendChild(css)
      const script = document.createElement('script')
      script.src = '/lr-reader/vendor/katex.min.js'
      script.onload = () => resolve()
      script.onerror = () => resolve()
      document.head.appendChild(script)
    })
  }
  return katexPromise
}

// Keep structured PDF blocks; parse only their inline Markdown contents.
// React creates all elements: source HTML is never executed.
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: false })
// MinerU mixes Markdown with a small set of HTML formatting tags. Recognize
// only attribute-free formatting; keep arbitrary source HTML as literal text.
markdown.inline.ruler.before('escape', 'reader_format', (state, silent) => {
  const source = state.src.slice(state.pos, state.posMax)
  const opening = /^<(strong|b|u|em|i|s|del|sub|sup|mark)\s*>/i.exec(source)
  let tag = 'strong'
  let inner = ''
  let length = 0
  if (opening) {
    tag = opening[1].toLowerCase()
    const boundary = new RegExp(`<(/?)${tag}\\s*>`, 'gi')
    boundary.lastIndex = opening[0].length
    let nesting = 1
    let match: RegExpExecArray | null
    while ((match = boundary.exec(source))) {
      nesting += match[1] ? -1 : 1
      if (!nesting) {
        inner = source.slice(opening[0].length, match.index)
        length = boundary.lastIndex
        break
      }
    }
  } else {
    // PDF exports often join the word after a bold label ending in punctuation.
    // CommonMark deliberately treats **Abstract—**Retrieval as literal text.
    const label = /^\*\*([^*\n]*[^\p{L}\p{N}\s*])\*\*(?=[\p{L}\p{N}])/u.exec(source)
    if (label && label[1].trim() === label[1]) { inner = label[1]; length = label[0].length }
  }
  const depth = Number(state.env.readerFormatDepth ?? 0)
  if (!length || depth >= 20) return false
  if (!silent) {
    const token = state.push('reader_format', tag, 0)
    token.children = []
    state.env.readerFormatDepth = depth + 1
    try { markdown.inline.parse(inner, markdown, state.env, token.children) }
    finally { state.env.readerFormatDepth = depth }
  }
  state.pos += length
  return true
})
markdown.inline.ruler.before('escape', 'reader_math', (state, silent) => {
  const source = state.src.slice(state.pos, state.posMax)
  const match = /^(?:\$\$([\s\S]+?)\$\$|\$([^$\n]+)\$|\\\[([\s\S]+?)\\\]|\\\(([^\n]+?)\\\))/.exec(source)
  if (!match) return false
  if (!silent) {
    const token = state.push('reader_math', 'span', 0)
    token.content = match[1] ?? match[2] ?? match[3] ?? match[4]
    token.meta = { display: match[1] !== undefined || match[3] !== undefined, original: match[0] }
  }
  state.pos += match[0].length
  return true
})

function MathText({ token }: { token: Token }) {
  const ref = useRef<HTMLSpanElement>(null)
  const display = token.meta?.display === true
  const original = String(token.meta?.original ?? token.content)
  useEffect(() => {
    let alive = true
    void loadKatex().then(() => {
      if (!alive || !ref.current || !window.katex) return
      window.katex.render(token.content, ref.current, {
        throwOnError: false, displayMode: display, trust: false, output: 'html',
      })
    })
    return () => { alive = false }
  }, [token, display])
  return <span className="zr-inline-math" ref={ref}>{original}</span>
}

function renderTokens(tokens: Token[]): ReactNode[] {
  const root: ReactNode[] = []
  const stack: Array<{ token: Token; children: ReactNode[] }> = []
  const append = (node: ReactNode) => (stack.at(-1)?.children ?? root).push(node)
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (token.nesting === 1) { stack.push({ token, children: [] }); continue }
    if (token.nesting === -1) {
      const entry = stack.pop()
      if (!entry) continue
      const tag = entry.token.tag
      const props = tag === 'a' ? { href: entry.token.attrGet('href') ?? undefined, target: '_blank', rel: 'noreferrer noopener' } : {}
      append(createElement(tag, { ...props, key: index }, ...entry.children))
      continue
    }
    if (token.type === 'reader_format') append(createElement(token.tag, { key: index }, ...renderTokens(token.children ?? [])))
    else if (token.type === 'reader_math') append(<MathText key={index} token={token} />)
    else if (token.type === 'code_inline') append(<code key={index}>{token.content}</code>)
    else if (token.type === 'hardbreak') append(<br key={index} />)
    else if (token.type === 'softbreak') append('\n')
    else if (token.children) append(<span key={index}>{renderTokens(token.children)}</span>)
    else append(token.content)
  }
  return root
}

export function RichText({ text }: { text: string }) {
  const tokens = useMemo(() => markdown.parseInline(text, {}).flatMap(token => token.children ?? []), [text])
  return <>{renderTokens(tokens)}</>
}
