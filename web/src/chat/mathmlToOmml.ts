/*
 * 把 KaTeX 生成的 Presentation MathML 转成 Word 剪贴板 HTML 里的 OMML（Office Math）。
 *
 * Word 写入剪贴板的 HTML 用 `<!--[if gte msEquation 12]>…<![endif]-->` 包住公式，读回时据此重建原生公式。
 * 这种「HTML 方言」与 docx 里的 OMML 略有不同：文字直接写在 <m:r> 里（没有 <m:t>），
 * 斜体 / 粗体靠外层 <i> / <b> 表达，属性元素自闭合，布尔值写作 "on"。这里按同样的方言输出。
 *
 * 只覆盖 KaTeX 会产出的 MathML 子集；认不出的元素按普通行处理，保证不丢内容。
 */

const FUNCTION_APPLICATION = '⁡'
// 不可见运算符（函数应用、不可见乘号、不可见逗号）在 Word 里没有对应字形，直接丢弃。
const INVISIBLE_OPERATORS_RE = /[⁡-⁤]/g

const NARY_OPERATORS = new Set([
  '∑',
  '∏',
  '∐',
  '∫',
  '∬',
  '∭',
  '∮',
  '∯',
  '∰',
  '∱',
  '∲',
  '∳',
  '⋃',
  '⋂',
  '⋁',
  '⋀',
  '⨀',
  '⨁',
  '⨂',
  '⨄',
  '⨆',
])

// KaTeX 用间距字符表示重音，Word 的 m:acc 需要对应的组合字符。
const ACCENT_CHARACTERS: Record<string, string> = {
  '^': '̂',
  ˆ: '̂',
  '̂': '̂',
  ˉ: '̅',
  '¯': '̅',
  '̅': '̅',
  '→': '⃗',
  '⃗': '⃗',
  '←': '⃖',
  '⃖': '⃖',
  '˙': '̇',
  '̇': '̇',
  '¨': '̈',
  '̈': '̈',
  '~': '̃',
  '˜': '̃',
  '̃': '̃',
  ˇ: '̌',
  '̌': '̌',
  '˘': '̆',
  '̆': '̆',
  ˊ: '́',
  '´': '́',
  '́': '́',
  ˋ: '̀',
  '`': '̀',
  '̀': '̀',
  '˚': '̊',
  '̊': '̊',
}
const BAR_CHARACTERS = new Set(['‾', '¯', '_', '̲'])
const GROUP_CHARACTERS = new Set(['⏞', '⏟', '⎴', '⎵', '⏜', '⏝'])

// 数学字母变体映射到 Unicode 数学字母区（Word 原样显示这些字形）；粗体 / 斜体改用 <b> / <i> 表达。
interface AlphabetOffsets {
  upper: number
  lower?: number
  digit?: number
  exceptions?: Record<string, number>
}
const MATH_ALPHABETS: Record<string, AlphabetOffsets> = {
  'double-struck': {
    upper: 0x1d538,
    lower: 0x1d552,
    digit: 0x1d7d8,
    exceptions: { C: 0x2102, H: 0x210d, N: 0x2115, P: 0x2119, Q: 0x211a, R: 0x211d, Z: 0x2124 },
  },
  script: {
    upper: 0x1d49c,
    lower: 0x1d4b6,
    exceptions: {
      B: 0x212c,
      E: 0x2130,
      F: 0x2131,
      H: 0x210b,
      I: 0x2110,
      L: 0x2112,
      M: 0x2133,
      R: 0x211b,
      e: 0x212f,
      g: 0x210a,
      o: 0x2134,
    },
  },
  fraktur: {
    upper: 0x1d504,
    lower: 0x1d51e,
    exceptions: { C: 0x212d, H: 0x210c, I: 0x2111, R: 0x211c, Z: 0x2128 },
  },
  'sans-serif': { upper: 0x1d5a0, lower: 0x1d5ba, digit: 0x1d7e2 },
  monospace: { upper: 0x1d670, lower: 0x1d68a, digit: 0x1d7f6 },
}

function mapMathAlphabet(text: string, offsets: AlphabetOffsets): string {
  return Array.from(text, (character) => {
    const exception = offsets.exceptions?.[character]
    if (exception) return String.fromCodePoint(exception)
    const code = character.codePointAt(0)!
    if (code >= 0x41 && code <= 0x5a) return String.fromCodePoint(offsets.upper + code - 0x41)
    if (code >= 0x61 && code <= 0x7a && offsets.lower !== undefined) {
      return String.fromCodePoint(offsets.lower + code - 0x61)
    }
    if (code >= 0x30 && code <= 0x39 && offsets.digit !== undefined) {
      return String.fromCodePoint(offsets.digit + code - 0x30)
    }
    return character
  }).join('')
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;')
}

function property(name: string, value: string): string {
  return `<m:${name} m:val="${escapeAttribute(value)}"/>`
}

function wrap(name: string, content: string): string {
  return `<m:${name}>${content}</m:${name}>`
}

type RunStyle = 'italic' | 'upright' | 'bold' | 'bold-italic'

/** Word 剪贴板里的一段公式文字：<m:r> 外套字体，再按字形套 <i> / <b>。 */
function run(text: string, style: RunStyle): string {
  if (!text) return ''
  let html = `<span style='font-family:"Cambria Math",serif'><m:r>${escapeText(text)}</m:r></span>`
  if (style === 'italic' || style === 'bold-italic') html = `<i>${html}</i>`
  if (style === 'bold' || style === 'bold-italic') html = `<b>${html}</b>`
  return html
}

function elementChildren(element: Element): Element[] {
  return Array.from(element.children).filter(
    (child) => child.localName !== 'annotation' && child.localName !== 'annotation-xml',
  )
}

function textOf(element: Element): string {
  return (element.textContent ?? '').replace(INVISIBLE_OPERATORS_RE, '')
}

function isOperator(element: Element | undefined, text?: string): element is Element {
  if (element?.localName !== 'mo') return false
  return text === undefined || (element.textContent ?? '').trim() === text
}

function isFence(element: Element | undefined): element is Element {
  return isOperator(element) && element.getAttribute('fence') === 'true'
}

/** 函数名（sin、lim、rank 等）以「函数应用」符收尾，后一个元素是它的参数。 */
function endsWithFunctionApplication(element: Element): boolean {
  switch (element.localName) {
    case 'mo':
      return (element.textContent ?? '').trim() === FUNCTION_APPLICATION
    case 'mrow':
    case 'mstyle': {
      const last = elementChildren(element).at(-1)
      return last ? endsWithFunctionApplication(last) : false
    }
    case 'msub':
    case 'msup':
    case 'msubsup':
    case 'munder':
    case 'mover':
    case 'munderover': {
      const base = elementChildren(element)[0]
      return base ? endsWithFunctionApplication(base) : false
    }
    default:
      return false
  }
}

interface NaryParts {
  operator: string
  limitLocation: 'undOvr' | 'subSup'
  lower?: Element
  upper?: Element
}

/** ∑、∫ 等大型运算符连同上下限转成 m:nary，主体取紧随其后的元素。 */
function naryPartsOf(element: Element): NaryParts | null {
  const [base, first, second] = elementChildren(element)
  if (!isOperator(base) || !NARY_OPERATORS.has((base.textContent ?? '').trim())) return null
  const operator = (base.textContent ?? '').trim()
  switch (element.localName) {
    case 'msub':
      return { operator, limitLocation: 'subSup', lower: first }
    case 'msup':
      return { operator, limitLocation: 'subSup', upper: first }
    case 'msubsup':
      return { operator, limitLocation: 'subSup', lower: first, upper: second }
    case 'munder':
      return { operator, limitLocation: 'undOvr', lower: first }
    case 'mover':
      return { operator, limitLocation: 'undOvr', upper: first }
    case 'munderover':
      return { operator, limitLocation: 'undOvr', lower: first, upper: second }
    default:
      return null
  }
}

function naryXml(parts: NaryParts, body: string): string {
  const properties =
    property('chr', parts.operator) +
    property('limLoc', parts.limitLocation) +
    (parts.lower ? '' : property('subHide', 'on')) +
    (parts.upper ? '' : property('supHide', 'on'))
  return wrap(
    'nary',
    wrap('naryPr', properties) +
      wrap('sub', parts.lower ? convert(parts.lower) : '') +
      wrap('sup', parts.upper ? convert(parts.upper) : '') +
      wrap('e', body),
  )
}

/** 转换一行兄弟元素：大型运算符与函数名会吞下紧随其后的元素作为主体 / 参数。 */
function convertRow(items: Element[]): string {
  let xml = ''
  let index = 0
  while (index < items.length) {
    const taken = takeItem(items, index)
    xml += taken.xml
    index = taken.next
  }
  return xml
}

function takeItem(items: Element[], index: number): { xml: string; next: number } {
  const item = items[index]!
  const nary = naryPartsOf(item)
  if (nary) {
    if (index + 1 >= items.length) return { xml: naryXml(nary, ''), next: index + 1 }
    const body = takeItem(items, index + 1)
    return { xml: naryXml(nary, body.xml), next: body.next }
  }

  const applicationFollows = isOperator(items[index + 1], FUNCTION_APPLICATION)
  if (applicationFollows || (!isOperator(item) && endsWithFunctionApplication(item))) {
    const argumentIndex = index + (applicationFollows ? 2 : 1)
    if (argumentIndex >= items.length) return { xml: convert(item), next: argumentIndex }
    const argument = takeItem(items, argumentIndex)
    return {
      xml: wrap('func', wrap('fName', convert(item)) + wrap('e', argument.xml)),
      next: argument.next,
    }
  }
  return { xml: convert(item), next: index + 1 }
}

/** `\left( … \middle| … \right)` 这类成对伸缩定界符转成 m:d。 */
function convertFencedRow(children: Element[]): string | null {
  const opens = isFence(children[0])
  const closes = children.length > 1 && isFence(children.at(-1))
  if (!opens && !closes) return null
  const inner = children.slice(opens ? 1 : 0, closes ? -1 : undefined)
  const segments: Element[][] = [[]]
  let separator: string | null = null
  for (const child of inner) {
    if (isFence(child)) {
      separator ??= (child.textContent ?? '').trim()
      segments.push([])
    } else {
      segments.at(-1)!.push(child)
    }
  }
  const properties =
    property('begChr', opens ? (children[0]!.textContent ?? '').trim() : '') +
    (separator === null ? '' : property('sepChr', separator)) +
    property('endChr', closes ? (children.at(-1)!.textContent ?? '').trim() : '')
  return wrap(
    'd',
    wrap('dPr', properties) + segments.map((segment) => wrap('e', convertRow(segment))).join(''),
  )
}

function convertIdentifier(element: Element): string {
  const text = textOf(element)
  const variant = element.getAttribute('mathvariant')
  const alphabet = variant ? MATH_ALPHABETS[variant] : undefined
  if (alphabet) return run(mapMathAlphabet(text, alphabet), 'upright')
  switch (variant) {
    case 'normal':
      return run(text, 'upright')
    case 'bold':
      return run(text, 'bold')
    case 'bold-italic':
      return run(text, 'bold-italic')
    case 'italic':
      return run(text, 'italic')
    default:
      // MathML 约定：单个字符的标识符默认斜体，多字符（sin、lim）默认正体。
      return run(text, Array.from(text).length === 1 ? 'italic' : 'upright')
  }
}

function spaceFor(element: Element): string {
  const width = Number.parseFloat(element.getAttribute('width') ?? '')
  if (!(width > 0)) return ''
  return run(width >= 0.8 ? ' ' : width >= 0.4 ? ' ' : ' ', 'upright')
}

function convertUnderOver(element: Element): string {
  const [base, first, second] = elementChildren(element)
  if (!base) return ''
  if (element.localName === 'munderover') {
    const lower = wrap(
      'limLow',
      wrap('e', convert(base)) + wrap('lim', first ? convert(first) : ''),
    )
    return wrap('limUpp', wrap('e', lower) + wrap('lim', second ? convert(second) : ''))
  }

  const isOver = element.localName === 'mover'
  const script = first
  const scriptText = script && isOperator(script) ? (script.textContent ?? '').trim() : ''
  const isAccent = element.getAttribute(isOver ? 'accent' : 'accentunder') === 'true'
  if (
    scriptText &&
    BAR_CHARACTERS.has(scriptText) &&
    (isAccent || script?.getAttribute('stretchy') === 'true')
  ) {
    return wrap(
      'bar',
      wrap('barPr', property('pos', isOver ? 'top' : 'bot')) + wrap('e', convert(base)),
    )
  }
  if (scriptText && GROUP_CHARACTERS.has(scriptText)) {
    const groupProperties =
      property('chr', scriptText) +
      property('pos', isOver ? 'top' : 'bot') +
      property('vertJc', isOver ? 'bot' : 'top')
    return wrap('groupChr', wrap('groupChrPr', groupProperties) + wrap('e', convert(base)))
  }
  const accent = ACCENT_CHARACTERS[scriptText]
  if (isAccent && accent) {
    return wrap('acc', wrap('accPr', property('chr', accent)) + wrap('e', convert(base)))
  }
  return wrap(
    isOver ? 'limUpp' : 'limLow',
    wrap('e', convert(base)) + wrap('lim', script ? convert(script) : ''),
  )
}

function convertTable(element: Element): string {
  const rows = elementChildren(element).filter((child) => child.localName === 'mtr')
  const columnCount = Math.max(1, ...rows.map((row) => elementChildren(row).length))
  const alignments = (element.getAttribute('columnalign') ?? '').split(/\s+/).filter(Boolean)
  const columns = Array.from({ length: columnCount }, (_, index) => {
    const align = alignments[Math.min(index, alignments.length - 1)] ?? 'center'
    const justification = align === 'left' || align === 'right' ? align : 'center'
    return wrap('mc', wrap('mcPr', property('count', '1') + property('mcJc', justification)))
  }).join('')
  const rowXml = rows
    .map((row) => {
      const cells = elementChildren(row)
      return wrap(
        'mr',
        Array.from({ length: columnCount }, (_, index) => {
          const cell = cells[index]
          return wrap('e', cell ? convertRow(elementChildren(cell)) : '')
        }).join(''),
      )
    })
    .join('')
  return wrap('m', wrap('mPr', wrap('mcs', columns)) + rowXml)
}

function convertEnclosure(element: Element): string {
  const notations = new Set((element.getAttribute('notation') ?? '').split(/\s+/).filter(Boolean))
  const strikes: Array<[string, string]> = [
    ['updiagonalstrike', 'strikeBLTR'],
    ['downdiagonalstrike', 'strikeTLBR'],
    ['horizontalstrike', 'strikeH'],
    ['verticalstrike', 'strikeV'],
  ]
  const boxed = notations.has('box')
  const properties =
    (boxed
      ? ''
      : ['hideTop', 'hideBot', 'hideLeft', 'hideRight']
          .map((name) => property(name, 'on'))
          .join('')) +
    strikes
      .filter(([notation]) => notations.has(notation))
      .map(([, name]) => property(name, 'on'))
      .join('')
  return wrap(
    'borderBox',
    (properties ? wrap('borderBoxPr', properties) : '') +
      wrap('e', convertRow(elementChildren(element))),
  )
}

// f' 在 MathML 里是上标的撇号，但撇号字形本身已经抬高，Word 中应作为普通字符紧跟底数。
const PRIME_RE = /^[′″‴⁗]+$/

function isPrime(element: Element | undefined): element is Element {
  return isOperator(element) && PRIME_RE.test((element.textContent ?? '').trim())
}

function convertScript(element: Element): string {
  const [base, first, second] = elementChildren(element)
  const superscript =
    element.localName === 'msup' ? first : element.localName === 'msubsup' ? second : undefined
  if (isPrime(superscript)) {
    const primed = convert(superscript)
    if (element.localName === 'msup') return (base ? convert(base) : '') + primed
    return (
      wrap(
        'sSub',
        wrap('e', base ? convert(base) : '') + wrap('sub', first ? convert(first) : ''),
      ) + primed
    )
  }
  const baseXml = wrap('e', base ? convert(base) : '')
  switch (element.localName) {
    case 'msub':
      return wrap('sSub', baseXml + wrap('sub', first ? convert(first) : ''))
    case 'msup':
      return wrap('sSup', baseXml + wrap('sup', first ? convert(first) : ''))
    default:
      return wrap(
        'sSubSup',
        baseXml +
          wrap('sub', first ? convert(first) : '') +
          wrap('sup', second ? convert(second) : ''),
      )
  }
}

function convert(element: Element): string {
  switch (element.localName) {
    case 'mi':
      return convertIdentifier(element)
    case 'mn':
      return run(textOf(element), 'italic')
    case 'mo':
      return run(textOf(element).trim(), 'italic')
    case 'mtext':
    case 'ms':
      return run(textOf(element), 'upright')
    case 'mspace':
      return spaceFor(element)
    case 'mrow': {
      const children = elementChildren(element)
      return convertFencedRow(children) ?? convertRow(children)
    }
    case 'mfrac': {
      const [numerator, denominator] = elementChildren(element)
      const thickness = element.getAttribute('linethickness')
      const noBar = thickness !== null && Number.parseFloat(thickness) === 0
      return wrap(
        'f',
        (noBar ? wrap('fPr', property('type', 'noBar')) : '') +
          wrap('num', numerator ? convert(numerator) : '') +
          wrap('den', denominator ? convert(denominator) : ''),
      )
    }
    case 'msqrt':
      return wrap(
        'rad',
        wrap('radPr', property('degHide', 'on')) +
          wrap('deg', '') +
          wrap('e', convertRow(elementChildren(element))),
      )
    case 'mroot': {
      const [radicand, index] = elementChildren(element)
      return wrap(
        'rad',
        wrap('deg', index ? convert(index) : '') + wrap('e', radicand ? convert(radicand) : ''),
      )
    }
    case 'msub':
    case 'msup':
    case 'msubsup':
      return convertScript(element)
    case 'munder':
    case 'mover':
    case 'munderover':
      return convertUnderOver(element)
    case 'mtable':
      return convertTable(element)
    case 'menclose':
      return convertEnclosure(element)
    case 'mphantom':
      return ''
    default:
      // math、semantics、mstyle、mpadded 等容器只影响排版细节，按普通行展开。
      return convertRow(elementChildren(element))
  }
}

/**
 * KaTeX 的 <math> 元素 → Word 剪贴板 HTML 中的 OMML。
 * 块级公式包在 m:oMathPara 里，Word 会把它排成独立居中的一段。
 */
export function mathmlToOmml(math: Element, display: boolean): string {
  const equation = wrap('oMath', convertRow(elementChildren(math)))
  return display ? wrap('oMathPara', equation) : equation
}
