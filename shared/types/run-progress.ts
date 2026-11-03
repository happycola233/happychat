/** 仅供管理端读取的运行快照，不含请求正文、响应正文或供应商凭据。 */
export interface RunProgress {
  phase: 'connecting' | 'waiting_output' | 'streaming' | 'retry_wait'
  attempt: number
  maxAttempts: number
  requestStartedAt: number | null
  updatedAt: number
  nextRetryAt: number | null
  upstreamResponseLatencyMs: number | null
  /** 当前尝试实际发送的上游模型 ID。 */
  modelLabel: string
  modelDisplayName: string
  /** 当前尝试所走的供应商与线路；故障转移后随之更新。升级前的快照没有 routeId。 */
  providerId: string
  providerLabel: string
  routeId?: string
}
