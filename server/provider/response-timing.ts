export interface UpstreamResponseTimingSample {
  requestStartedAtMs: number
  responseHeadersAtMs: number
  ok: boolean
}

/** 上游 POST 的网络边界观察器；不用于模型目录等后台管理请求。 */
export interface UpstreamResponseTimingObserver {
  onRequestStart(requestStartedAtMs: number): void
  onResponseHeaders(sample: UpstreamResponseTimingSample): void
}

/**
 * 汇总一次业务调用中的上游 HTTP 往返耗时。
 *
 * Responses 兼容降级可能先收到失败响应再重试；此时以首次请求开始到首次成功响应头为准。
 * 如果最终没有成功响应，则保留首次失败响应头，确保 HTTP 失败仍有可审计的网络耗时。
 */
export class UpstreamResponseLatencyTracker implements UpstreamResponseTimingObserver {
  private firstRequestStartedAtMs: number | null = null
  private firstResponseHeadersAtMs: number | null = null
  private firstSuccessfulResponseHeadersAtMs: number | null = null

  onRequestStart(requestStartedAtMs: number): void {
    this.firstRequestStartedAtMs ??= requestStartedAtMs
  }

  onResponseHeaders(sample: UpstreamResponseTimingSample): void {
    this.onRequestStart(sample.requestStartedAtMs)
    this.firstResponseHeadersAtMs ??= sample.responseHeadersAtMs
    if (sample.ok) this.firstSuccessfulResponseHeadersAtMs ??= sample.responseHeadersAtMs
  }

  get latencyMs(): number | null {
    if (this.firstRequestStartedAtMs === null) return null
    const responseHeadersAtMs =
      this.firstSuccessfulResponseHeadersAtMs ?? this.firstResponseHeadersAtMs
    if (responseHeadersAtMs === null) return null
    return Math.max(0, Math.round(responseHeadersAtMs - this.firstRequestStartedAtMs))
  }
}
