interface Fence {
  marker: '`' | '~'
  length: number
}

export interface ReasoningSection {
  title: string | null
  body: string
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

function headingFromLine(line: string): string | null {
  const match = line.trim().match(/^\*\*([^*\r\n][^*\r\n]*?)\*\*$/)
  const title = match?.[1]?.trim()
  return title ? title : null
}

export function splitReasoningSections(text: string): ReasoningSection[] {
  const sections: ReasoningSection[] = []
  let title: string | null = null
  let body = ''
  let fence: Fence | null = null

  const flush = () => {
    if (!title && !body.trim()) return
    sections.push({ title, body: body.trim() })
    title = null
    body = ''
  }

  for (const line of text.split(/(?<=\n)/)) {
    if (fence) {
      body += line
      if (closesFence(line, fence)) fence = null
      continue
    }

    const openingFence = parseFence(line)
    if (openingFence) {
      fence = openingFence
      body += line
      continue
    }

    const nextTitle = headingFromLine(line)
    if (nextTitle) {
      flush()
      title = nextTitle
      continue
    }

    body += line
  }

  flush()
  return sections
}
