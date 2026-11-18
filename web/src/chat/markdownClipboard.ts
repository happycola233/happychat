import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeKatex from 'rehype-katex'
import rehypeStringify from 'rehype-stringify'
import { markdownSanitizeSchema, rehypeSafeInlineStyles, rehypeSanitize } from './markdownHtml'
import { normalizeMarkdownMath } from './markdownMath'
import { MARKDOWN_REMARK_PLUGINS } from './markdownRemarkPlugins'
import { mathmlToOmml } from './mathmlToOmml'

/*
 * 回答复制到剪贴板的两种格式：
 * - text/plain：纯文本，公式为 LaTeX 源码（行内 $…$，块级 $$…$$）；
 * - text/html（「复制时保留格式」开启时）：排版后的正文，公式写成 Word 剪贴板格式的 OMML，
 *   粘贴到 Word 即为可编辑的原生公式；其他富文本编辑器看不到 Word 专用部分，只会看到 LaTeX 源码。
 *
 * 两个入口：
 * - 选中含公式的文字按 Ctrl+C：浏览器默认会把 KaTeX 的排版碎片（隐藏的 MathML、逐字母的 span）一并复制，
 *   粘贴出来是满屏换行的乱码，这里接管 copy 事件；选区不含公式时完全不干预。
 * - 回答下方的复制按钮：纯文本仍是 Markdown 原文，HTML 由原文按聊天渲染的同一套语法重新生成。
 */

const FORMULA_SELECTOR = '.katex-display, .katex'
const TEX_ANNOTATION_SELECTOR = 'annotation[encoding="application/x-tex"]'
/** Word 剪贴板 HTML 中 m: 前缀对应的命名空间，须在根元素声明，Word 才会读取公式。 */
const WORD_HTML_MATH_NAMESPACE = 'http://schemas.microsoft.com/office/2004/12/omml'
// 复制按钮、图标、代码块顶栏、Artifact 预览等界面元素不属于正文。
const NON_CONTENT_SELECTOR =
  'button, svg, iframe, script, style, [aria-hidden="true"], .hc-code-block-header'

interface CopiedFormula {
  tex: string
  display: boolean
  /** KaTeX 同时输出的 MathML，用于生成 Word 公式。 */
  mathml: Element | null
}

export interface SelectionClipboardData {
  text: string
  /** 关闭「复制时保留格式」时为 null，只写纯文本。 */
  html: string | null
}

/** 选区端点落在公式内部时扩到整个公式，避免复制出半截 LaTeX。 */
function closestFormula(node: Node): Element | null {
  const element = node instanceof Element ? node : node.parentElement
  return element?.closest('.katex-display') ?? element?.closest('.katex') ?? null
}

export function cloneSelectionWithWholeFormulas(selection: Selection): DocumentFragment {
  const fragment = document.createDocumentFragment()
  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index).cloneRange()
    const startFormula = closestFormula(range.startContainer)
    if (startFormula) range.setStartBefore(startFormula)
    const endFormula = closestFormula(range.endContainer)
    if (endFormula) range.setEndAfter(endFormula)
    fragment.append(range.cloneContents())
  }
  return fragment
}

/** 最外层的公式节点：块级公式取 .katex-display，不重复计入其中的 .katex。 */
function formulaElements(root: ParentNode): Element[] {
  return Array.from(root.querySelectorAll(FORMULA_SELECTOR)).filter(
    (element) => !element.parentElement?.closest(FORMULA_SELECTOR),
  )
}

function readFormula(element: Element): CopiedFormula | null {
  const tex = element.querySelector(TEX_ANNOTATION_SELECTOR)?.textContent?.trim()
  if (!tex) return null
  const mathml = element.querySelector('math')
  return {
    tex,
    // 聊天页渲染的块级公式带 .katex-display 外壳；只输出 MathML 时只有 display="block"。
    display:
      element.classList.contains('katex-display') || mathml?.getAttribute('display') === 'block',
    mathml,
  }
}

function texWithDelimiters(formula: CopiedFormula, multiline: boolean): string {
  if (!formula.display) return `$${formula.tex}$`
  return multiline ? `$$\n${formula.tex}\n$$` : `$$${formula.tex}$$`
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Word 读条件注释里的 OMML，其他程序把条件注释当普通注释，只显示 LaTeX 源码。 */
function wordFormulaHtml(formula: CopiedFormula): string {
  const fallback = escapeHtml(texWithDelimiters(formula, false))
  const content = formula.mathml
    ? `<!--[if gte msEquation 12]>${mathmlToOmml(formula.mathml, formula.display)}<![endif]-->` +
      `<![if !msEquation]>${fallback}<![endif]>`
    : fallback
  return formula.display ? `<p>${content}</p>` : content
}

/**
 * 正文 HTML：公式换成 Word 公式，去掉界面元素，并在根元素声明 OMML 命名空间。
 * 在无浏览上下文的文档里处理，克隆出的图片不会发起请求。
 */
function wordClipboardHtml(content: DocumentFragment): string {
  const inertDocument = document.implementation.createHTMLDocument('')
  const host = inertDocument.createElement('div')
  host.append(inertDocument.importNode(content, true))
  // 公式先换成注释占位：它的 HTML 含条件注释，不能经 DOM 再序列化一遍。
  const replacements: string[] = []
  for (const element of formulaElements(host)) {
    const formula = readFormula(element)
    if (!formula) continue
    element.replaceWith(inertDocument.createComment(`hc-math-${replacements.length}`))
    replacements.push(wordFormulaHtml(formula))
  }
  for (const element of host.querySelectorAll(NON_CONTENT_SELECTOR)) element.remove()
  const body = host.innerHTML.replace(
    /<!--hc-math-(\d+)-->/g,
    (_match, index: string) => replacements[Number(index)]!,
  )
  return `<html xmlns:m="${WORD_HTML_MATH_NAMESPACE}"><body>${body}</body></html>`
}

/**
 * innerText 按排版生成纯文本（段落、列表、表格的换行与浏览器默认复制一致），
 * 但只对挂在文档里、参与布局的节点生效，所以临时放到视口外再读取。
 */
function renderedText(content: Node): string {
  const host = document.createElement('div')
  host.style.cssText =
    'position:fixed;left:-100000px;top:0;width:960px;opacity:0;pointer-events:none;white-space:normal'
  host.append(content)
  document.body.append(host)
  try {
    return host.innerText
  } finally {
    host.remove()
  }
}

function selectionPlainText(fragment: DocumentFragment): string {
  const copy = fragment.cloneNode(true) as DocumentFragment
  for (const element of formulaElements(copy)) {
    const formula = readFormula(element)
    if (!formula) continue
    if (formula.display) {
      // 块级公式按段落处理，前后各空一行；pre-wrap 让 innerText 保留 $$ 与源码之间的换行。
      const block = document.createElement('p')
      block.style.whiteSpace = 'pre-wrap'
      block.textContent = texWithDelimiters(formula, true)
      element.replaceWith(block)
    } else {
      element.replaceWith(texWithDelimiters(formula, false))
    }
  }
  return renderedText(copy)
}

/** 选区片段含公式时生成剪贴板内容；不含公式返回 null，交给浏览器默认复制。 */
export function createSelectionClipboardData(
  fragment: DocumentFragment,
  withFormatting: boolean,
): SelectionClipboardData | null {
  if (!formulaElements(fragment).some(readFormula)) return null
  return {
    text: selectionPlainText(fragment),
    html: withFormatting ? wordClipboardHtml(fragment) : null,
  }
}

export function handleMathCopy(event: ClipboardEvent, withFormatting: boolean) {
  const clipboard = event.clipboardData
  const selection = document.getSelection()
  if (event.defaultPrevented || !clipboard || !selection || selection.isCollapsed) return
  const data = createSelectionClipboardData(
    cloneSelectionWithWholeFormulas(selection),
    withFormatting,
  )
  if (!data) return
  clipboard.setData('text/plain', data.text)
  if (data.html !== null) clipboard.setData('text/html', data.html)
  event.preventDefault()
}

/** 全局接管含公式选区的复制（聊天、思考过程、分享页、公告共用同一套 KaTeX 输出）。 */
export function installMathCopyHandler(isFormattingEnabled: () => boolean) {
  document.addEventListener('copy', (event) => handleMathCopy(event, isFormattingEnabled()))
}

// 与聊天渲染同一套语法与净化规则；公式只需 MathML（含 LaTeX 注解），代码不做高亮。
const clipboardHtmlProcessor = unified()
  .use(remarkParse)
  .use(MARKDOWN_REMARK_PLUGINS)
  .use(remarkRehype, { allowDangerousHtml: true, footnoteLabel: '脚注' })
  .use(rehypeRaw)
  .use(rehypeSafeInlineStyles)
  .use(rehypeSanitize, markdownSanitizeSchema)
  .use(rehypeKatex, { output: 'mathml' })
  .use(rehypeStringify)

/** 回答原文 → 复制按钮写入的 HTML（Word 中公式为可编辑公式）。 */
export function markdownClipboardHtml(markdown: string): string {
  const template = document.createElement('template')
  template.innerHTML = String(clipboardHtmlProcessor.processSync(normalizeMarkdownMath(markdown)))
  return wordClipboardHtml(template.content)
}
