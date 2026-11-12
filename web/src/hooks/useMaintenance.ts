import { useQuery } from '@tanstack/react-query'
import type { MaintenanceStatusDTO } from '@shared/types/api'
import { apiGet } from '../api/client'

export const MAINTENANCE_QUERY_KEY = ['maintenance'] as const

/** 维护期间每隔这么久检查一次，结束后页面自动恢复。 */
const MAINTENANCE_POLL_INTERVAL_MS = 15_000

/**
 * 公开的维护状态，未登录也能读取。
 * 平时不轮询：维护开始由被拦下的请求（MaintenanceGate 订阅）或切回页面时的刷新发现。
 */
export function useMaintenanceStatus() {
  return useQuery({
    queryKey: MAINTENANCE_QUERY_KEY,
    queryFn: () => apiGet<MaintenanceStatusDTO>('/maintenance'),
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => (query.state.data?.notice ? MAINTENANCE_POLL_INTERVAL_MS : false),
  })
}
