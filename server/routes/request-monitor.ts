import type { Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { AppEnv } from '../http/types'
import { requestMonitorEvents } from '../services/request-monitor-events'

/** 挂在 requireAdmin 后；初次连接与重连均补刷快照，不需要重放通知历史。 */
export function streamRequestMonitor(c: Context<AppEnv>) {
  c.header('Cache-Control', 'no-cache, no-transform')
  c.header('X-Accel-Buffering', 'no')
  c.header('Connection', 'keep-alive')

  return streamSSE(
    c,
    async (stream) => {
      let changed = true
      let wake: (() => void) | undefined
      const unsubscribe = requestMonitorEvents.subscribe(() => {
        changed = true
        wake?.()
      })
      stream.onAbort(() => wake?.())
      const heartbeat = setInterval(() => wake?.(), 15_000)
      heartbeat.unref()

      try {
        while (!stream.aborted) {
          // 同一轮内多次阶段/审计写入合并为一次通知，慢连接也不会积压事件队列。
          if (changed) {
            changed = false
            await stream.writeSSE({ event: 'change', data: '{}' })
          } else {
            await stream.write(': keep-alive\n\n')
          }
          if (!changed && !stream.aborted) {
            await new Promise<void>((resolve) => {
              wake = resolve
            })
            wake = undefined
          }
        }
      } finally {
        clearInterval(heartbeat)
        unsubscribe()
      }
    },
    async () => {
      // 浏览器离开或断线时结束本条通知流，不影响正在运行的生成任务。
    },
  )
}
