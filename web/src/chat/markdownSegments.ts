interface Fence {
  marker: '`' | '~'
  length: number
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
