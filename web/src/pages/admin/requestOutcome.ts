import type { UsageLogKind, UsageResult } from '@shared/types/domain'
import type { BadgeTone } from '../../components/ui/Badge'

export interface RequestOutcomePresentation {
  label: string
  tone: BadgeTone
  summary: string
  contentNote: string
  nextStep: string | null
  reasonLabel: string | null
  usageNote: string
}

export const REQUEST_RESULT_LABELS: Record<UsageResult, string> = {
  completed: '完成',
  incomplete: '已截断',
  refused: '已拒绝',
  filtered: '内容过滤',
  failed: '失败',
  canceled: '已取消',
  interrupted: '已中断',
}

const TERMINAL_REASON_LABELS: Record<string, string> = {
  refusal: '模型拒绝回答',
  content_filter: '内容安全过滤',
  max_output_tokens: '达到最大输出 Token',
  max_tokens: '达到最大输出 Token',
  length: '达到最大输出长度',
  model_context_window_exceeded: '超出模型上下文窗口',
  context_window_exceeded: '超出模型上下文窗口',
  user_cancelled: '用户主动停止',
  server_restart: '服务重启',
  response_failed: 'Responses 返回失败终态',
  tool_calls: '模型请求调用工具',
  tool_use: '模型请求调用工具',
  invalid_response: '上游响应缺少有效终止标记',
  incomplete_stream: '响应流未正常结束',
  network_error: '网络连接异常',
  upstream_error: '上游请求异常',
  response_error: 'Responses 流返回错误事件',
  unsupported_finish_reason: '上游返回不支持的结束原因',
  authentication_error: '上游鉴权失败',
  permission_error: '上游权限不足',
  rate_limit_error: '上游请求限流',
  rate_limit_exceeded: '上游请求限流',
  overloaded_error: '上游服务过载',
  server_error: '上游服务错误',
  internal_server_error: '上游内部错误',
  api_error: '上游 API 错误',
  pause_turn_limit: 'Anthropic 连续暂停次数过多',
  request_too_large: '请求体过大',
}

function terminalReasonLabel(reason: string | null): string | null {
  if (!reason) return null
  return TERMINAL_REASON_LABELS[reason] ?? '记录的具体原因代码'
}

function discardedContentNote(kind: UsageLogKind): string {
  return kind === 'title'
    ? '上游输出未用于标题，系统已改用首条用户消息生成本地回退标题。'
    : '可能已经产生的部分内容不会作为正常助手答复保存。'
}

function usageNote(kind: UsageLogKind): string {
  return kind === 'title'
    ? '标题总结不占用户额度；Token 与成本仍按上游实际返回值记录。'
    : 'Token 与成本按上游实际返回值记录，与这里的业务结果分开计算。'
}

/**
 * 请求事件的展示语义集中在这里，列表与用户详情共用，避免再次从 success 猜测状态。
 * 生命周期 outcome 由服务端持久化，refusal / content_filter 则通过 result 显式区分。
 */
export function requestOutcomePresentation(input: {
  result: UsageResult
  terminalReason: string | null
  kind: UsageLogKind
}): RequestOutcomePresentation {
  const reasonLabel = terminalReasonLabel(input.terminalReason)
  const recordedUsage = usageNote(input.kind)

  switch (input.result) {
    case 'completed':
      return {
        label: REQUEST_RESULT_LABELS.completed,
        tone: 'success',
        summary: '上游正常结束，并返回了可用结果。',
        contentNote:
          input.kind === 'title' ? '上游输出已用于会话标题。' : '生成内容已作为正常结果保留。',
        nextStep: null,
        reasonLabel,
        usageNote: recordedUsage,
      }
    case 'incomplete':
      return {
        label: REQUEST_RESULT_LABELS.incomplete,
        tone: 'warning',
        summary:
          input.terminalReason === 'model_context_window_exceeded' ||
          input.terminalReason === 'context_window_exceeded'
            ? '生成达到模型上下文窗口限制后停止，并非上游调用失败。'
            : '生成达到输出限制后停止，并非上游调用失败。',
        contentNote:
          input.kind === 'title'
            ? '可用的部分输出会作为标题；输出为空时会改用本地回退标题。'
            : '已经生成的部分内容仍会保留。',
        nextStep:
          input.terminalReason === 'model_context_window_exceeded' ||
          input.terminalReason === 'context_window_exceeded'
            ? '需要继续时，可减少会话上下文或改用上下文窗口更大的模型。'
            : '需要完整内容时，可提高最大输出 Token，或让模型从截断处继续。',
        reasonLabel,
        usageNote: recordedUsage,
      }
    case 'refused':
      return {
        label: REQUEST_RESULT_LABELS.refused,
        tone: 'warning',
        summary: '模型通过正常的 API 响应明确拒绝了本次请求；这不是网络故障。',
        contentNote: discardedContentNote(input.kind),
        nextStep: '检查任务是否触及模型限制，调整表达或改用更适合的模型；原样重试通常无效。',
        reasonLabel,
        usageNote: recordedUsage,
      }
    case 'filtered':
      return {
        label: REQUEST_RESULT_LABELS.filtered,
        tone: 'warning',
        summary: '上游内容安全系统终止了输出；这不是普通的长度截断。',
        contentNote: discardedContentNote(input.kind),
        nextStep:
          input.kind === 'title'
            ? '检查标题提示词与对话摘要是否触发上游安全策略，必要时查看供应商或服务日志。'
            : '检查本轮输入与会话历史是否触发上游安全策略，必要时结合错误日志排查。',
        reasonLabel,
        usageNote: recordedUsage,
      }
    case 'canceled':
      return {
        label: REQUEST_RESULT_LABELS.canceled,
        tone: 'neutral',
        summary: '请求在完成前被用户或系统取消。',
        contentNote: '已生成内容可能不完整，不能视为正常完成。',
        nextStep: '若并非主动停止，可结合终止原因、服务日志与前端日志确认取消来源。',
        reasonLabel,
        usageNote: recordedUsage,
      }
    case 'interrupted':
      return {
        label: REQUEST_RESULT_LABELS.interrupted,
        tone: 'danger',
        summary: '服务未取得完整终态，通常是生成期间发生了服务重启。',
        contentNote: '已生成内容可能不完整，不能视为正常完成。',
        nextStep: '可以重试；若反复出现，请检查服务重启记录与服务日志。',
        reasonLabel,
        usageNote: recordedUsage,
      }
    case 'failed':
      return {
        label: REQUEST_RESULT_LABELS.failed,
        tone: 'danger',
        summary: '上游返回失败终态，或请求、响应流处理过程中发生异常。',
        contentNote: discardedContentNote(input.kind),
        nextStep:
          input.kind === 'title'
            ? '标题调用不单独生成错误事件；请用下方原因代码检查供应商配置或服务日志。'
            : '可用下方原因代码在错误日志中定位更具体的上游或网络错误。',
        reasonLabel,
        usageNote: recordedUsage,
      }
  }
}
