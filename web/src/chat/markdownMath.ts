import { transformOutsideFencedCode, transformOutsideInlineCode } from './markdownSegments'

/*
 * 模型输出公式的定界符五花八门：GPT 多用 \( \) / \[ \]，其他模型多用 $ / $$。
 * remark-math 只认 $ 系列，且关闭了单 $（避免把金额误判成公式），因此渲染前统一改写：
 * - 块级公式一律改成独占多行的 $$ … $$；
 * - 行内公式一律改成同一行内的 $$…$$（remark-math 视作行内公式）。
 */

function displayMathReplacement(prefix: string, body: string): string {
  const trimmed = body.trim()
  const leadingBreak = prefix && !/\n[ \t]*$/.test(prefix) ? '\n\n' : ''
  return `${prefix}${leadingBreak}$$\n${trimmed}\n$$\n\n`
}

function normalizeStandaloneDisplayMathDelimiters(text: string): string {
  // Markdown containers such as blockquotes need to keep their line prefix on
  // the delimiter lines; otherwise `>` is swallowed into the KaTeX source.
  return text.replace(/^([ \t]*(?:>[ \t]*)*)\\(?:\[|\])[ \t]*$/gm, (_match, prefix: string) => {
    return `${prefix}$$`
  })
}

// 独占一行的 `$$…$$`（可带缩进或引用前缀）：remark-math 会把它当成行内公式，按块级公式展开。
const STANDALONE_DOUBLE_DOLLAR_LINE_RE =
  /^([ \t]*(?:>[ \t]*)*)\$\$(?!\$)([^`\n]*?[^$`\n\\])\$\$[ \t]*$/gm

function promoteStandaloneDoubleDollarMath(text: string): string {
  return text.replace(STANDALONE_DOUBLE_DOLLAR_LINE_RE, (match, prefix: string, body: string) => {
    const trimmed = body.trim()
    if (!trimmed || trimmed.includes('$$')) return match
    return `${prefix}$$\n${prefix}${trimmed}\n${prefix}$$`
  })
}

function isEscaped(text: string, index: number): boolean {
  let backslashes = 0
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) backslashes += 1
  return backslashes % 2 === 1
}

function dollarRunLength(text: string, start: number): number {
  let end = start
  while (text[end] === '$') end += 1
  return end - start
}

/** 从 from 起找下一个未转义、长度恰为 length 的 $ 串。 */
function findDollarRun(text: string, from: number, length: number): number {
  for (let index = from; index < text.length; index += 1) {
    if (text[index] !== '$' || isEscaped(text, index)) continue
    const runLength = dollarRunLength(text, index)
    if (runLength === length) return index
    index += runLength - 1
  }
  return -1
}

const WHITESPACE_RE = /\s/
const DIGIT_RE = /\d/

/**
 * 单 $ 行内公式按 Pandoc 的规则识别，以免把金额误判为公式：
 * 开头 $ 后不能是空白；结尾 $ 前不能是空白、后面不能紧跟数字；中间不能跨空行，也不能夹着其他 $。
 * 例如 `$5 到 $10`、`$20,000 and $30,000` 都不会被当成公式。
 */
function normalizeSingleDollarMath(text: string): string {
  let result = ''
  let cursor = 0
  let index = 0
  while (index < text.length) {
    if (text[index] !== '$' || isEscaped(text, index)) {
      index += 1
      continue
    }
    const runLength = dollarRunLength(text, index)
    if (runLength > 1) {
      // $$…$$ 已是 remark-math 能识别的公式，原样跳过；未闭合（如流式生成中）则后文都按公式内容处理。
      const close = findDollarRun(text, index + runLength, runLength)
      if (close === -1) break
      index = close + runLength
      continue
    }

    const close = findDollarRun(text, index + 1, 1)
    const body = close === -1 ? '' : text.slice(index + 1, close)
    const isMath =
      close !== -1 &&
      body.length > 0 &&
      !WHITESPACE_RE.test(body[0]!) &&
      !WHITESPACE_RE.test(body[body.length - 1]!) &&
      !DIGIT_RE.test(text[close + 1] ?? '') &&
      !body.includes('$') &&
      !/\n[ \t]*\n/.test(body)
    if (!isMath) {
      index += 1
      continue
    }
    result += `${text.slice(cursor, index)}$$${body}$$`
    index = close + 1
    cursor = index
  }
  return result + text.slice(cursor)
}

function normalizeMathDelimiters(text: string): string {
  const latexNormalized = normalizeStandaloneDisplayMathDelimiters(text)
    .replace(/(^|[^\\])\\\[([\s\S]*?)\\\]/g, (_match, prefix: string, body: string) =>
      displayMathReplacement(prefix, body),
    )
    .replace(/(^|[^\\])\\\(([\s\S]*?)\\\)/g, (_match, prefix: string, body: string) => {
      const trimmed = body.trim()
      return `${prefix}$$${trimmed}$$`
    })
  return normalizeSingleDollarMath(latexNormalized)
}

export function normalizeMarkdownMath(text: string): string {
  return transformOutsideFencedCode(text, (segment) =>
    // 按整行判断「独占一行」，须在按行内代码切分之前进行（含反引号的行不处理）。
    transformOutsideInlineCode(promoteStandaloneDoubleDollarMath(segment), normalizeMathDelimiters),
  )
}
