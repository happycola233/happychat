import { afterEach, describe, expect, it, vi } from 'vitest'
import { useStreamStore } from '../store/stream'

class FakeEventSource {
  static sources: FakeEventSource[] = []
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onopen: (() => void) | null = null
  close = vi.fn()
  constructor() {
    FakeEventSource.sources.push(this)
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  useStreamStore.getState().clear('chat')
})

describe('队列交接后的旧流', () => {
  it('旧终态和断线不会覆盖新一轮，也不继续重连已被替换的流', async () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    vi.stubGlobal('window', { setTimeout, clearTimeout })
    const { startStream } = await import('./streamManager')
    startStream({ runId: 'old', conversationId: 'chat', assistantMessageId: 'a', fromSeq: -1 })
    const old = FakeEventSource.sources.at(-1)!
    startStream({ runId: 'new', conversationId: 'chat', assistantMessageId: 'b', fromSeq: -1 })
    const current = FakeEventSource.sources.at(-1)!
    old.onmessage?.({
      data: JSON.stringify({ seq: 1, type: 'run.done', data: { state: 'completed' } }),
    })
    old.onerror?.()
    expect(old.close).toHaveBeenCalled()
    expect(useStreamStore.getState().byConversation.chat?.runId).toBe('new')
    expect(useStreamStore.getState().byConversation.chat?.status).toBe('streaming')
    current.onmessage?.({
      data: JSON.stringify({ seq: 1, type: 'run.done', data: { state: 'completed' } }),
    })
  })
})
