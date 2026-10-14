/** 仅供管理端读取的运行快照，不含请求正文、响应正文或供应商凭据。 */
export interface RunProgress {
  phase: 'connecting' | 'waiting_output' | 'streaming' | 'retry_wait'
  attempt: number
  maxAttempts: number
  requestStartedAt: number | null
  updatedAt: number
  nextRetryAt: number | null
  upstreamResponseLatencyMs: number | null
  modelLabel: string
  modelDisplayName: string
  providerId: string
  providerLabel: string
}
