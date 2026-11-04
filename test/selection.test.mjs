// selection.test.mjs — 选区矩形合并的回归测试（LightRead 算法的移植结果）。
//   node test/selection.test.mjs
//
// 覆盖用户反馈的三个症状：
//   · 行与行重叠 → 检查合并后同一页的矩形**竖向上不重叠**；
//   · 多选（一片全高亮）→ 太宽的矩形在 rangeToPdfRects 里被丢掉（这里测 merge 的边界）；
//   · 行内碎片断开 → 间隙 ≤3pt 必须并成一条。
import assert from 'node:assert/strict'

const { mergeLineRects, trimVerticalOverlaps } = await import('../lib/_test-selection.mjs')

let passed = 0
const check = (name, fn) => {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

/** 同一页矩形两两之间的竖向重叠面积比例（用于验证"行间不再叠深"） */
function maxVerticalOverlap(rects) {
  let worst = 0
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i]
      const b = rects[j]
      const top = Math.max(a.y, b.y)
      const bottom = Math.min(a.y + a.h, b.y + b.h)
      if (bottom <= top) continue
      worst = Math.max(worst, (bottom - top) / Math.min(a.h, b.h))
    }
  }
  return worst
}

check('同一行的相邻碎片合并成一条', () => {
  const out = mergeLineRects([
    { x: 10, y: 100, w: 40, h: 12 },
    { x: 52, y: 100, w: 60, h: 12 }, // 间隙 2pt
  ])
  assert.equal(out.length, 1)
  assert.equal(out[0].x, 10)
  assert.equal(out[0].x + out[0].w, 112)
})

check('间隙大于 3pt 时断开（不把中间空白填满）', () => {
  const out = mergeLineRects([
    { x: 10, y: 100, w: 20, h: 12 },
    { x: 40, y: 100, w: 20, h: 12 }, // 间隙 10pt
  ])
  assert.equal(out.length, 2)
})

check('两行之间有竖向重叠也不会被并成一条', () => {
  const out = mergeLineRects([
    { x: 10, y: 100, w: 200, h: 12 }, // 100..112
    { x: 10, y: 110, w: 200, h: 12 }, // 110..122（重叠 2pt）
  ])
  assert.equal(out.length, 2)
})

check('合并后同一页矩形竖向不重叠（行间不再叠色）', () => {
  // 模拟 pdf.js 的典型输出：每行被切成 2~3 段，且相邻行的矩形有 1~3pt 重叠
  const raw = []
  for (let line = 0; line < 6; line += 1) {
    const y = 100 + line * 13 // 行距 13pt，字高 12pt → 天然重叠 1pt
    raw.push({ x: 10, y, w: 60, h: 12 })
    raw.push({ x: 71, y, w: 80, h: 12 })
    raw.push({ x: 152, y, w: 40, h: 12 })
  }
  const out = mergeLineRects(raw)
  assert.equal(out.length, 6, `应合成 6 行，实际 ${out.length}`)
  assert.ok(maxVerticalOverlap(out) < 0.01, `竖向重叠 ${maxVerticalOverlap(out)}`)
})

check('重复矩形被去重', () => {
  const r = { x: 10, y: 100, w: 40, h: 12 }
  const out = mergeLineRects([r, { ...r }, { ...r, x: 10.5 }])
  assert.equal(out.length, 1)
})

check('包裹关系（小矩形落在同一行大矩形里）只留一条', () => {
  const out = mergeLineRects([
    { x: 10, y: 100, w: 200, h: 12 },
    { x: 30, y: 100, w: 40, h: 12 },
  ])
  assert.equal(out.length, 1)
  assert.equal(out[0].x + out[0].w, 210)
})

check('多行多段混合：行数正确、每行一条', () => {
  const out = mergeLineRects([
    { x: 10, y: 100, w: 50, h: 12 },
    { x: 62, y: 100, w: 50, h: 12 },
    { x: 10, y: 114, w: 100, h: 12 },
    { x: 10, y: 128, w: 30, h: 12 },
    { x: 90, y: 128, w: 30, h: 12 },
  ])
  assert.equal(out.length, 4, JSON.stringify(out))
})

check('单矩形原样返回', () => {
  const out = mergeLineRects([{ x: 1, y: 2, w: 3, h: 4 }])
  assert.deepEqual(out, [{ x: 1, y: 2, w: 3, h: 4 }])
})

check('收边：相邻行均分重叠区，不再叠色', () => {
  // 两行相距 7.8px、盒高 10px（实测值），重叠 2.2px
  const out = trimVerticalOverlaps([
    { x: 922, y: 216.5, w: 207, h: 10 },
    { x: 952, y: 224.3, w: 153, h: 10 },
  ])
  assert.equal(out.length, 2)
  assert.ok(maxVerticalOverlap(out) < 0.001, `仍有重叠 ${maxVerticalOverlap(out)}`)
  // 每行至少保留一半高度，不会把细行压没
  for (const r of out) assert.ok(r.h >= 5, JSON.stringify(r))
})

check('收边不影响不相邻的行', () => {
  const input = [
    { x: 10, y: 100, w: 100, h: 10 },
    { x: 10, y: 130, w: 100, h: 10 },
  ]
  assert.deepEqual(trimVerticalOverlaps(input), input)
})

console.log(`selection.test: ${passed} passed`)
