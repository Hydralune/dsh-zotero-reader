// build-client.mjs — 浏览器半边构建：src/client/** → lib/client.js
//
// DSH 的客户端插件是一段 __ModuleLoader__.load({ id, factory }) 脚本，
// factory 里可以 require('react') / require('react/jsx-runtime')。
// 所以这里用 esbuild 打成 CJS，再包一层 factory，产物仍是单文件、可直接被宿主加载。
import * as esbuild from 'esbuild'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(root, '..')
const bodyPath = path.join(projectRoot, 'lib/_client.cjs')
const outPath = path.join(projectRoot, 'lib/client.js')
const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))

const result = await esbuild.build({
  entryPoints: [path.join(projectRoot, 'src/client/plugin.tsx')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  outfile: bodyPath,
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
  legalComments: 'none',
  logLevel: 'info',
  metafile: true,
})

const body = fs.readFileSync(bodyPath, 'utf8')
const banner = `// 由 scripts/build-client.mjs 生成，请勿手改（源码在 src/client/）。
`
const out = `${banner}window.__ModuleLoader__.load({
	id: ${JSON.stringify(pkg.name)},
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
${body}
		return module.exports;
	}
});
`
fs.writeFileSync(outPath, out, 'utf8')

fs.rmSync(bodyPath, { force: true }) // 中间产物不留在仓库里
const bytes = fs.statSync(outPath).size
const inputs = Object.keys(result.metafile.inputs).length
console.log(`client built: lib/client.js (${inputs} modules, ${(bytes / 1024).toFixed(1)} kB)`)

// 测试用 ESM 产物：把选区几何算法单独导出来，给 test/harness.html 直接 import。
// 这样验证的就是真代码，不是复制品。
await esbuild.build({
  entryPoints: [path.join(projectRoot, 'src/client/viewer/selection.ts')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: path.join(projectRoot, 'lib/_test-selection.mjs'),
  legalComments: 'none',
  logLevel: 'silent',
})
console.log('test bundle: lib/_test-selection.mjs')

// 预览产物：真组件 + React 一起打包，给 test/preview.html 直接用（不经过 DSH 加载器）
await esbuild.build({
  entryPoints: [path.join(projectRoot, 'test/preview-entry.tsx')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  outfile: path.join(projectRoot, 'lib/_preview.js'),
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'none',
  logLevel: 'silent',
})
console.log('preview bundle: lib/_preview.js')

// 契约测试产物：跑真实 apply()，验证注册与「点图标不抢对话」
await esbuild.build({
  entryPoints: [path.join(projectRoot, 'test/contract-entry.tsx')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  outfile: path.join(projectRoot, 'lib/_contract.js'),
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'none',
  logLevel: 'silent',
})
console.log('contract bundle: lib/_contract.js')
