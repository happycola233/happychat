/**
 * 服务端私有的历史推理重放信封。该数据含上游 opaque 密文，禁止加入 MessageDTO
 * 或任何面向浏览器、分享快照、日志的公共数据结构。
 */
export interface ReasoningReplayContextV1 {
  version: 1
  source: {
    providerId: string
    providerBaseUrl: string
    upstreamModelId: string
  }
  /** 终态响应回显的有效上下文模式，仅记录备用，首版不主动发送 reasoning.context。 */
  reasoningContext: string | null
  /** 终态 response.output 中 type === 'reasoning' 的 item 原样数组。 */
  items: unknown[]
}
