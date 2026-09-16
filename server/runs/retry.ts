import { RUN_EVENT_TYPE } from '@shared/types/events'
import type { UpstreamRetryOptions } from '../provider/retry'
import { getAppConfig } from '../services/appConfig'

/** 与生成事件共用 seq/持久化通道，使刷新与后台返回看到同一重试进度。 */
export async function runRetryOptions(
  persistEmit: (type: string, data: Record<string, unknown>) => number,
): Promise<UpstreamRetryOptions> {
  return {
    policy: (await getAppConfig()).upstreamRetry,
    onProgress: (progress) => persistEmit(RUN_EVENT_TYPE.retry, { ...progress }),
  }
}
