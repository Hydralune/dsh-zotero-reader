import { getMarkdownBlocks, pdfUrl, type ZoteroPaper } from './api'
import { paperSource, type Explanation } from './dshComposer'
import { openPdf } from './viewer/pdf'

export const DEFAULT_PAPER_PROMPT = `请阅读本次随附的完整论文 PDF 与全文上下文，严格按以下规则和固定框架，用中文解读这篇论文。

【解读规则】
1. 所有内容严格基于论文原文。明确区分「作者自述」「原文证据支持的判断」与「解读者推断」，禁止编造、无意义复述或把作者主张当作已证实事实。语言凝练、专业；重要判断注明章节、页码、图表或公式依据。
2. 不遗漏下方 0–9 模块。根据论文所属学科及类型（理论、方法、实验、系统、应用、综述等）调整分析内容；不适用或原文未提供的项目明确标注，不能补造。隐含假设、创新层级和局限分析须注明推断依据；没有外部文献证据时，不声称已证实其全球首创性。
3. 翻译忠于原文语义，符合中文学术写作规范，采用领域通用术语，不添加主观解读。按语境区分术语，例如智能体的 memory 译为「记忆」，计算机硬件的 memory 才译为「内存」。
4. 优先使用本次附件和所列本地 PDF，不自行联网搜索论文。若某页、公式、图片或章节无法读取，明确指出缺失并说明对结论的影响。

【固定输出框架】
0. 摘要与结论完整翻译
- 摘要全文精准翻译。
- 结论章节全文精准翻译；没有独立结论章节时，说明情况并翻译承担总结作用的对应部分，注明位置。

1. 论文结构与核心脉络
- 梳理章节排布及各章节核心内容。
- 提炼从问题提出、研究设计到结论验证的完整论证路径。

2. 研究背景与核心问题
- 本文所属领域、具体研究对象及核心痛点或未解决问题。
- 明确提出的研究问题与核心目标。

3. 核心研究假设
- 作者明确提出的显性假设或核心命题。
- 隐含前提及其依据，例如对研究对象、数据分布、测量方法、模型能力、环境条件或问题边界的默认设定。区分原文与推断。

4. 真实创新与核心动力
- 作者自述的主要创新点。
- 基于原文证据及论文自身对相关工作的比较，分析真正增量与创新本质；按适用情况标注：范式级 / 理论或方法级 / 系统架构级 / 实证发现级 / 工程优化级 / 现有方案组合改进。
- 指出突破的关键瓶颈或解决的本质缺陷，并说明创新判断的证据边界。

5. 假设论证与验证逻辑
- 验证路径，例如理论推导、实验、观察、案例、系统实现与实测，或文献综合。
- 核心证据、证明、对照、消融、基线或稳健性分析分别支持哪些结论。
- 逻辑断点、证据不足及尚未充分验证的环节。

6. 核心方法与关键结果
- 方法、框架、理论、实验设计或系统的核心思路。
- 关键数据、材料、样本、测试基准、评价指标及研究环境；不适用时说明。
- 最关键的量化结果或核心结论，保留必要单位、条件与不确定性信息。

7. 论述质量评估
- 研究问题、核心假设或命题是否清晰。
- 方法、实验或证明描述是否完整，是否具备复现或核查条件。
- 结论是否与证据对应，是否存在夸大、因果越界或超出适用范围。
- 逻辑是否自洽；给出论述清晰度评分（1–10 分）并说明理由。

8. 研究局限与参考价值
- 作者明确承认的局限。
- 原文证据支持或可合理推断的适用边界与潜在缺陷，明确区分两者。
- 对相应领域的实际参考价值与适用场景。

9. 凝练总结
- 用一段约 150 字总结这篇论文。
- 再用 20 字以内概括核心贡献。
- 最后列出相关关键词。`

export const DEFAULT_SUMMARY_SHORTCUT = 'Alt+Shift+S'
export const SUMMARY_SETTINGS_KEY = 'zr-paper-summary-v1'
export interface SummarySettings { prompt: string; shortcut: string }
export function normalizeSummarySettings(value: unknown): SummarySettings {
  const candidate = value as Partial<SummarySettings> | null
  return { prompt: typeof candidate?.prompt === 'string' && candidate.prompt.trim() ? candidate.prompt : DEFAULT_PAPER_PROMPT,
    shortcut: typeof candidate?.shortcut === 'string' && (!candidate.shortcut || /^(?:(?:Ctrl|Alt|Meta|Shift)\+)+[A-Z0-9]$/.test(candidate.shortcut)) ? candidate.shortcut : DEFAULT_SUMMARY_SHORTCUT }
}
export function shortcutFromEvent(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey'>): string | null {
  if (!(event.ctrlKey || event.altKey || event.metaKey) || !/^[a-z0-9]$/i.test(event.key)) return null
  return [...(event.ctrlKey ? ['Ctrl'] : []), ...(event.altKey ? ['Alt'] : []), ...(event.metaKey ? ['Meta'] : []),
    ...(event.shiftKey ? ['Shift'] : []), event.key.toUpperCase()].join('+')
}

/** Read all pages without starting a slow parser job. The original PDF always accompanies the text. */
export async function preparePaperSummary(paper: ZoteroPaper, prompt: string, progress: (message: string) => void): Promise<Explanation> {
  progress('正在准备论文全文…')
  const { doc } = await openPdf(pdfUrl(paper))
  const pdf = new File([new Uint8Array(await doc.getData())], paper.file, { type: 'application/pdf' })
  let cached: Awaited<ReturnType<typeof getMarkdownBlocks>> | null = null
  try { cached = await getMarkdownBlocks(paper) } catch { /* Unparsed PDFs use the already loaded PDF text layer. */ }
  const pages = new Array<string>(doc.numPages)
  const locations: Array<{ page: number }> = []
  let next = 1, done = 0
  const worker = async () => {
    while (next <= doc.numPages) {
      const page = next++
      const parsed = cached?.pages.find(item => item.page === page)
      if (parsed?.blocks.some(block => (block.markdown || block.text)?.trim())) {
        pages[page - 1] = parsed.blocks.map(block => `[${block.type}; bbox=${JSON.stringify(block.bbox)}]\n${block.markdown || block.text || '图表或公式请核对原 PDF'}`).join('\n\n')
      } else {
        const content = await (await doc.getPage(page)).getTextContent()
        pages[page - 1] = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('') || '本页没有可提取文字，请读取随附 PDF 的页面图像。'
      }
      done++
      progress(`正在准备全文 ${done}/${doc.numPages} 页…`)
    }
  }
  await Promise.all([worker(), worker(), worker()])
  for (let page = 1; page <= doc.numPages; page++) locations.push({ page })
  return { document: pdf, parts: { source: paperSource(paper), title: paper.title, intent: 'ask', task: 'paper', question: prompt,
    locations, text: pages.map((text, index) => `【PDF 第 ${index + 1} 页】\n${text}`).join('\n\n'),
    context: `本次任务针对完整论文，共 ${doc.numPages} 页，附有原始 PDF。全文文本按物理页组织；图表、公式、排版和无法提取的文字以 PDF 原页为准。` } }
}
