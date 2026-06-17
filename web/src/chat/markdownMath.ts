import { transformOutsideFencedCode } from './markdownSegments'

function backtickRunLength(text: string, start: number): number {
  let end = start
  while (text[end] === '`') end += 1
  return end - start
}

function findClosingBackticks(text: string, start: number, length: number): number {
  for (let index = start; index < text.length; index += 1) {
    if (text[index] !== '`') continue
    const runLength = backtickRunLength(text, index)
    if (runLength === length) return index
    index += runLength - 1
  }
  return -1
}

function transformOutsideInlineCode(
  text: string,
  transform: (segment: string) => string,
): string {
  let result = ''
  let outside = ''
  let index = 0

  while (index < text.length) {
    if (text[index] !== '`') {
      outside += text[index]
      index += 1
      continue
    }

    const runLength = backtickRunLength(text, index)
    const close = findClosingBackticks(text, index + runLength, runLength)
    if (close === -1) {
      outside += text.slice(index, index + runLength)
      index += runLength
      continue
    }

    result += transform(outside)
    outside = ''
    result += text.slice(index, close + runLength)
    index = close + runLength
  }

  return result + transform(outside)
}

function displayMathReplacement(prefix: string, body: string): string {
  const trimmed = body.trim()
  const leadingBreak = prefix && !/\n[ \t]*$/.test(prefix) ? '\n\n' : ''
  return `${prefix}${leadingBreak}$$\n${trimmed}\n$$\n\n`
}

function normalizeLatexDelimiters(text: string): string {
  return text
    .replace(/(^|[^\\])\\\[([\s\S]*?)\\\]/g, (_match, prefix: string, body: string) =>
      displayMathReplacement(prefix, body),
    )
    .replace(/(^|[^\\])\\\(([\s\S]*?)\\\)/g, (_match, prefix: string, body: string) => {
      const trimmed = body.trim()
      return `${prefix}$${trimmed}$`
    })
}

export function normalizeMarkdownMath(text: string): string {
  return transformOutsideFencedCode(text, (segment) =>
    transformOutsideInlineCode(segment, normalizeLatexDelimiters),
  )
}
