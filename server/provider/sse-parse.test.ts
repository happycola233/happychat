import { describe, expect, it } from 'vitest'
import { parseSSEStream } from './sse-parse'

function streamOf(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text)
  return new ReadableStream({
    start(controller) {
      // 拆成两块，验证跨块拼接
      const mid = Math.floor(bytes.length / 2)
      controller.enqueue(bytes.slice(0, mid))
      controller.enqueue(bytes.slice(mid))
      controller.close()
    },
  })
}

async function collect(text: string) {
  const out = []
  for await (const ev of parseSSEStream(streamOf(text))) out.push(ev)
  return out
}

describe('parseSSEStream', () => {
  it('解析多事件并按 data.type 标注', async () => {
    const sse =
      'event: response.created\ndata: {"type":"response.created","sequence_number":0}\n\n' +
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"你好","obfuscation":"xxxx","sequence_number":1}\n\n'
    const evs = await collect(sse)
    expect(evs).toHaveLength(2)
    expect(evs[0]!.type).toBe('response.created')
    expect(evs[1]!.type).toBe('response.output_text.delta')
    expect(evs[1]!.data.delta).toBe('你好')
  })

  it('剥除 output_text.delta 的 obfuscation 字段', async () => {
    const sse = 'data: {"type":"response.output_text.delta","delta":"a","obfuscation":"pad"}\n\n'
    const evs = await collect(sse)
    expect('obfuscation' in evs[0]!.data).toBe(false)
  })

  it('忽略 [DONE] 与空块', async () => {
    const sse = 'data: [DONE]\n\n'
    expect(await collect(sse)).toHaveLength(0)
  })
})
