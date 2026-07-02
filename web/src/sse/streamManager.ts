import { isTerminalEventType, type WireEvent } from '@shared/types/events'
import { useStreamStore } from '../store/stream'
import { initialLive, reduceEvent } from './eventReducer'

interface StartOptions {
  runId: string
  conversationId: string
  assistantMessageId: string
  fromSeq: number
  upstreamStartedAt?: number | null
  reasoningDurationMs?: number | null
  imageStartedAt?: number | null
  reasoningEnabled?: boolean
  onBeforeTerminal?: () => void
  onTerminal?: () => void
}

const open = new Map<string, EventSource>()
const MAX_ATTEMPTS = 6

/**
 * 打开/恢复某 run 的 SSE 流，折叠事件到 stream store。
 * - 续传游标 ?from=<lastSeq>；收到任一终止事件即停止。
 * - 客户端自管退避重连；超过上限放弃（视为中断，触发刷新历史）。
 */
export function startStream(opts: StartOptions): void {
  if (open.has(opts.runId)) return

  const store = useStreamStore.getState()
  store.set(opts.conversationId, {
    runId: opts.runId,
    assistantMessageId: opts.assistantMessageId,
    ...initialLive(opts.upstreamStartedAt ?? null, opts.reasoningEnabled ?? false),
    reasoningDurationMs: opts.reasoningDurationMs ?? null,
    imageStartedAt: opts.imageStartedAt ?? null,
  })

  let lastSeq = opts.fromSeq
  let attempt = 0
  let stopped = false

  const finish = () => {
    stopped = true
    const es = open.get(opts.runId)
    es?.close()
    open.delete(opts.runId)
  }

  const connect = () => {
    const es = new EventSource(`/api/runs/${opts.runId}/stream?from=${lastSeq}`, {
      withCredentials: true,
    })
    open.set(opts.runId, es)

    es.onopen = () => {
      attempt = 0
    }

    es.onmessage = (e) => {
      let wire: WireEvent
      try {
        wire = JSON.parse(e.data) as WireEvent
      } catch {
        return
      }
      if (typeof wire.seq === 'number') lastSeq = wire.seq
      const cur = useStreamStore.getState().byConversation[opts.conversationId]
      if (!cur || cur.runId !== opts.runId) return
      if (isTerminalEventType(wire.type)) opts.onBeforeTerminal?.()
      useStreamStore.getState().set(opts.conversationId, { ...cur, ...reduceEvent(cur, wire) })
      if (isTerminalEventType(wire.type)) {
        finish()
        opts.onTerminal?.()
      }
    }

    es.onerror = () => {
      es.close()
      open.delete(opts.runId)
      if (stopped) return
      attempt += 1
      if (attempt > MAX_ATTEMPTS) {
        useStreamStore.getState().patch(opts.conversationId, { status: 'interrupted' })
        opts.onTerminal?.()
        return
      }
      const delay = Math.min(1000 * 2 ** (attempt - 1), 30_000)
      setTimeout(() => {
        if (!stopped) connect()
      }, delay)
    }
  }

  connect()
}

export function isStreamOpen(runId: string): boolean {
  return open.has(runId)
}
