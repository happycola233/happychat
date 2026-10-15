import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

/** SSE 负责即时刷新，页面原有轮询负责断线期间的补查；暂停或隐藏页面时关闭订阅。 */
export function useRequestMonitor(live: boolean, query: 'usage-events' | 'error-events'): void {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!live) return
    let source: EventSource | null = null
    const syncVisibility = () => {
      if (document.visibilityState === 'hidden') {
        source?.close()
        source = null
      } else if (!source) {
        source = new EventSource('/api/admin/request-events/stream', { withCredentials: true })
        source.addEventListener('change', () => {
          void queryClient.invalidateQueries({ queryKey: ['admin', query] })
        })
      }
    }
    syncVisibility()
    document.addEventListener('visibilitychange', syncVisibility)
    return () => {
      document.removeEventListener('visibilitychange', syncVisibility)
      source?.close()
    }
  }, [live, query, queryClient])
}
