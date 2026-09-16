import { UpstreamError } from './errors'

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
  try {
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
  } finally {
    // 引擎在终态/流内错误处提前退出时同样释放连接，避免重试遗留读锁。
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

function parseBlock(block: string): StreamEvent | null {
  let dataStr = ''
  let eventName = ''
  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (line.startsWith('data:')) dataStr += line.slice(5).replace(/^ /, '')
    else if (line.startsWith('event:')) eventName = line.slice(6).trim()
  }
  if (!dataStr || dataStr === '[DONE]') return null
  let data: Record<string, unknown>
  try {
    data = JSON.parse(dataStr) as Record<string, unknown>
  } catch {
    throw new UpstreamError({
      message: '上游返回了无法解析的流数据',
      status: 200,
      type: 'invalid_stream',
      code: 'malformed_sse_json',
    })
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new UpstreamError({
      message: '上游返回了无效的流数据',
      status: 200,
      type: 'invalid_stream',
    })
  }
  const type =
    typeof data.type === 'string' ? data.type : eventName || (data.error ? 'error' : 'unknown')
  if (type === 'response.output_text.delta' && 'obfuscation' in data) {
    delete data.obfuscation
  }
  return { type, data }
}
