import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { writeFile, rm } from 'node:fs/promises'

const target = new URL(`./.richtext-${process.pid}.mjs`, import.meta.url)
try {
  const result = await build({
    entryPoints: ['src/client/viewer/RichText.tsx'], bundle: true,
    platform: 'node', format: 'esm', jsx: 'automatic', packages: 'external', write: false,
  })
  await writeFile(target, result.outputFiles[0].contents)
  const { RichText } = await import(target.href)
  const render = text => renderToStaticMarkup(createElement(RichText, { text }))
  const sample = render('**助手** {initial\\_prompt} *emphasis* `a_b **literal**`')
  assert.match(sample, /<strong>助手<\/strong>/)
  assert.match(sample, /\{initial_prompt\}/)
  assert.match(sample, /<em>emphasis<\/em>/)
  assert.match(sample, /<code>a_b \*\*literal\*\*<\/code>/)
  assert.match(render('**bold $x_{i}$**'), /<strong>bold <span class="zr-inline-math">\$x_\{i\}\$<\/span><\/strong>/)
  assert.match(render('\\(x\\_i\\) and $$y^2$$'), /zr-inline-math/)
  assert.match(render('[link](https://example.org)'), /href="https:\/\/example.org"/)
  assert.equal(render('<strong><u>Received: 23 January 2026</u></strong>'), '<strong><u>Received: 23 January 2026</u></strong>')
  assert.equal(render('**Abstract—**Retrieval-augmented'), '<strong>Abstract—</strong>Retrieval-augmented')
  assert.equal(render('**Keywords—**Retrieval'), '<strong>Keywords—</strong>Retrieval')
  assert.equal(render('\\*Email id: author'), '*Email id: author')
  assert.equal(render('`<u>literal</u> **Abstract—**text`'), '<code>&lt;u&gt;literal&lt;/u&gt; **Abstract—**text</code>')
  assert.equal(render('<strong>outer <strong>inner</strong></strong>'), '<strong>outer <strong>inner</strong></strong>')
  assert.match(render('<u>**bold** and $x_i$</u>'), /<u><strong>bold<\/strong> and <span class="zr-inline-math">/)
  assert.ok(!render('<u onclick="alert(1)">bad</u>').includes('<u onclick='))
  const unsafe = render('<script>alert(1)</script> [bad](javascript:alert(1))')
  assert.ok(!unsafe.includes('<script>'))
  assert.ok(!unsafe.includes('href="javascript:'))
  console.log('RichText: Markdown escapes, emphasis, code, links, nested math, and source HTML checked')
} finally {
  await rm(target, { force: true })
}
