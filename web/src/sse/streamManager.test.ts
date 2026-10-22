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

describe('增量提交节奏', () => {
  it('同一帧内到达的增量合并为一次提交，终止事件立即提交', async () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      requestAnimationFrame: (callback: FrameRequestCallback) => frames.push(callback),
      cancelAnimationFrame: vi.fn(),
    })
    const { startStream } = await import('./streamManager')
    startStream({ runId: 'paced', conversationId: 'chat', assistantMessageId: 'a', fromSeq: -1 })
    const source = FakeEventSource.sources.at(-1)!
    const commits = vi.fn()
    const unsubscribe = useStreamStore.subscribe(commits)
    const delta = (seq: number, text: string) =>
      source.onmessage?.({
        data: JSON.stringify({ seq, type: 'response.output_text.delta', data: { delta: text } }),
      })

    delta(1, '你')
    delta(2, '好')
    expect(commits).not.toHaveBeenCalled()
    expect(frames).toHaveLength(1)

    frames[0]!(0)
    expect(commits).toHaveBeenCalledTimes(1)
    expect(useStreamStore.getState().byConversation.chat?.text).toBe('你好')

    delta(3, '！')
    source.onmessage?.({
      data: JSON.stringify({ seq: 4, type: 'run.done', data: { state: 'completed' } }),
    })
    expect(commits).toHaveBeenCalledTimes(2)
    expect(useStreamStore.getState().byConversation.chat?.text).toBe('你好！')
    unsubscribe()
  })
})
