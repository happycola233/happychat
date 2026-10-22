import { isTerminalEventType, type WireEvent } from '@shared/types/events'
import { useStreamStore } from '../store/stream'
import { initialLive, reduceEvents } from './eventReducer'

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
// 页面不可见时 requestAnimationFrame 暂停，用定时器兜底继续折叠事件（浏览器会再节流后台定时器）。
const HIDDEN_FLUSH_FALLBACK_MS = 250

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
    // 从头回放时由带时间戳的事件还原，不能把当前尝试的快照套到早先事件上。
    ...initialLive(
      opts.fromSeq < 0 ? null : (opts.upstreamStartedAt ?? null),
      opts.reasoningEnabled ?? false,
    ),
    reasoningDurationMs: opts.fromSeq < 0 ? null : (opts.reasoningDurationMs ?? null),
    imageStartedAt: opts.imageStartedAt ?? null,
  })

  let lastSeq = opts.fromSeq
  let attempt = 0
  let stopped = false
  let flushFrame: number | null = null
  let flushTimer: number | null = null
  let pendingEvents: WireEvent[] = []

  const cancelScheduledFlush = () => {
    if (flushFrame !== null) window.cancelAnimationFrame(flushFrame)
    if (flushTimer !== null) window.clearTimeout(flushTimer)
    flushFrame = null
    flushTimer = null
  }

  const finish = () => {
    stopped = true
    cancelScheduledFlush()
    pendingEvents = []
    const es = open.get(opts.runId)
    es?.close()
    open.delete(opts.runId)
  }

  const flushPending = () => {
    cancelScheduledFlush()
    if (!pendingEvents.length) return
    const batch = pendingEvents
    pendingEvents = []
    const cur = useStreamStore.getState().byConversation[opts.conversationId]
    if (!cur || cur.runId !== opts.runId) {
      finish()
      return
    }

    const terminal = batch.find((wire) => isTerminalEventType(wire.type))
    if (terminal) opts.onBeforeTerminal?.()
    useStreamStore.getState().set(opts.conversationId, { ...cur, ...reduceEvents(cur, batch) })
    if (terminal) {
      finish()
      opts.onTerminal?.()
    }
  }

  // 与绘制节奏对齐：一帧内到达的事件合并成一次提交，每帧最多重渲染一次，且紧贴绘制前完成。
  const scheduleFlush = () => {
    if (flushFrame !== null) return
    flushFrame = window.requestAnimationFrame(flushPending)
    flushTimer = window.setTimeout(flushPending, HIDDEN_FLUSH_FALLBACK_MS)
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
      if (isTerminalEventType(wire.type)) {
        pendingEvents.push(wire)
        flushPending()
        return
      }
      pendingEvents.push(wire)
      scheduleFlush()
    }

    es.onerror = () => {
      flushPending()
      es.close()
      open.delete(opts.runId)
      if (stopped) return
      if (useStreamStore.getState().byConversation[opts.conversationId]?.runId !== opts.runId) {
        finish()
        return
      }
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
