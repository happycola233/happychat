export interface StreamEvent {
  type: string
  data: Record<string, unknown>
}

/** 解析上游 SSE 字节流为事件序列。剥除 output_text.delta 的 obfuscation 干扰字段。 */
export async function* parseSSEStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    buf = buf.replace(/\r\n/g, '\n')
    let idx: number
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      const ev = parseBlock(block)
      if (ev) yield ev
    }
  }
  const tail = parseBlock(buf.replace(/\r\n/g, '\n'))
  if (tail) yield tail
}

function parseBlock(block: string): StreamEvent | null {
  let dataStr = ''
  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (line.startsWith('data:')) dataStr += line.slice(5).replace(/^ /, '')
  }
  if (!dataStr || dataStr === '[DONE]') return null
  let data: Record<string, unknown>
  try {
    data = JSON.parse(dataStr) as Record<string, unknown>
  } catch {
    return null
  }
  const type = typeof data.type === 'string' ? data.type : 'unknown'
  if (type === 'response.output_text.delta' && 'obfuscation' in data) {
    delete data.obfuscation
  }
  return { type, data }
}
