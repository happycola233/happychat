import type { RunErrorIdentity } from '@shared/types/domain'
import { displayableHttpStatus, type RunErrorKind } from '@shared/util/runError'

export interface RunErrorAdvice {
  hint: string | null
  /** 可以直接在聊天中完成的处理；context 打开当前对话的上下文优化。 */
  action: 'context' | null
}

const CONTACT_ADMIN = '这需要管理员处理，请联系管理员。'
const TRY_LATER = '这通常是暂时的，请稍后重新生成。'
const PERSISTENT_CONTACT_ADMIN = '请稍后重新生成；如果一直出现，请联系管理员。'

/**
 * 错误原因由服务端文案说明，这里只补充“接下来能做什么”。
 * 需要改站点配置的错误，普通用户只能联系管理员，管理员则直接指向对应的后台位置。
 */
export function runErrorAdvice(kind: RunErrorKind, viewerIsAdmin: boolean): RunErrorAdvice {
  const hint = (user: string | null, admin = user) => ({
    hint: viewerIsAdmin ? admin : user,
    action: null,
  })
  switch (kind) {
    case 'context_too_large':
      return {
        hint: '可以在「上下文优化」中减少保留的历史或附件，或精简本条消息后重新发送。',
        action: 'context',
      }
    case 'attachment_rejected':
      return hint('请更换图片，或转换为 PNG、JPEG 等常见格式后重新发送。')
    case 'content_blocked':
      return hint(null)
    case 'billing':
      return hint(CONTACT_ADMIN, '请检查供应商账户的余额、额度与支出上限。')
    case 'auth':
      return hint(CONTACT_ADMIN, '请在「管理后台 → 供应商」检查 API Key 与访问权限。')
    case 'not_found':
      return hint(
        '可以换个模型继续；如果一直出现，请联系管理员。',
        '请在「管理后台 → 模型」检查上游模型 ID，并确认供应商的 Base URL 与协议。',
      )
    case 'rate_limited':
      return hint(
        '请稍候片刻再重新生成。',
        '请稍候片刻再重新生成；频繁出现时，可检查供应商的速率限制。',
      )
    case 'timeout':
      return hint(
        '请稍后重新生成。',
        '请稍后重新生成；频繁出现时，可在「系统设置 → 自动重试」调整等待时长。',
      )
    case 'network':
      return hint(
        '请稍后重新生成。',
        '请稍后重新生成；持续出现时，请检查服务器到供应商的网络连接。',
      )
    case 'overloaded':
    case 'server_error':
      return hint(TRY_LATER)
    case 'invalid_request':
      return hint(
        '可以换个模型重新生成；如果一直出现，请联系管理员。',
        '请检查该模型的默认参数与高级 JSON；上游原始响应可在「错误日志」中查看。',
      )
    case 'invalid_response':
    case 'other':
      return hint(PERSISTENT_CONTACT_ADMIN, '上游原始响应可在「管理后台 → 错误日志」中查看。')
  }
}

/** 错误码与 HTTP 状态方便向管理员反馈；连接失败等没有可展示状态时自动省略。 */
export function runErrorMetaParts(error: RunErrorIdentity): string[] {
  const code = error.errorCode ?? error.errorType
  const status = displayableHttpStatus(error.httpStatus)
  return [code, status === null ? null : `HTTP ${status}`].filter((part): part is string =>
    Boolean(part),
  )
}
