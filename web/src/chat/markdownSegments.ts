interface Fence {
  marker: '`' | '~'
  length: number
}

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

function parseFence(line: string): Fence | null {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})/)
  if (!match?.[1]) return null
  return {
    marker: match[1][0] as Fence['marker'],
    length: match[1].length,
  }
}

function closesFence(line: string, fence: Fence): boolean {
  const next = parseFence(line)
  return Boolean(next && next.marker === fence.marker && next.length >= fence.length)
}

export function transformOutsideFencedCode(
  text: string,
  transform: (segment: string) => string,
): string {
  let result = ''
  let outside = ''
  let fence: Fence | null = null

  for (const line of text.split(/(?<=\n)/)) {
    if (fence) {
      result += line
      if (closesFence(line, fence)) fence = null
      continue
    }

    const openingFence = parseFence(line)
    if (openingFence) {
      result += transform(outside)
      outside = ''
      fence = openingFence
      result += line
      continue
    }

    outside += line
  }

  return result + transform(outside)
}

/** 对 Markdown 行内代码之外的片段做转换，支持任意长度的反引号定界符。 */
export function transformOutsideInlineCode(
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
