import assert from 'node:assert/strict'
import { build } from 'esbuild'

const built = await build({ entryPoints: ['src/client/viewer/selection-anchor.ts'], bundle: true, format: 'esm', write: false })
const { visibleSelectionAnchor, isScrollbarInteraction } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].contents).toString('base64'))
const viewport = { left: 100, top: 200, right: 700, bottom: 600 }
const line = { left: 150, right: 500, top: 350, bottom: 370 }
assert.equal(visibleSelectionAnchor([line], viewport).y, 350)
assert.equal(visibleSelectionAnchor([{ ...line, top: 310, bottom: 330 }], viewport).y, 310)
assert.equal(visibleSelectionAnchor([{ ...line, top: 90, bottom: 110 }], viewport), null)
assert.equal(visibleSelectionAnchor([line], viewport).y, 350)
assert.equal(visibleSelectionAnchor([{ ...line, top: 180, bottom: 210 }], viewport).y, 200)
assert.equal(visibleSelectionAnchor([{ ...line, left: 710, right: 750 }], viewport), null)
const root = { clientWidth: 590, clientHeight: 400, getBoundingClientRect: () => viewport }
assert.ok(isScrollbarInteraction({ target: root, clientX: 697, clientY: 300 }, root))
assert.ok(!isScrollbarInteraction({ target: root, clientX: 300, clientY: 300 }, root))
assert.ok(!isScrollbarInteraction({ target: {}, clientX: 697, clientY: 300 }, root))
console.log('Selection anchor: follows scrolling, clips visible lines, restores offscreen selection, and distinguishes scrollbar clicks')
