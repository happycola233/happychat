import type { ReasoningEffortOption } from './types/domain'

/** 会话 cookie 名 */
export const SESSION_COOKIE = 'hc_session'

/** 会话有效期（毫秒）：30 天 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * 新建/同步模型时可复用的 OpenAI 常用推理档位预设。
 * 这只是便捷模板，并非运行时白名单；每个模型都可保存完全自定义的值与描述。
 */
export const DEFAULT_REASONING_EFFORT_OPTIONS: readonly ReasoningEffortOption[] = [
  { value: 'none', description: '关闭' },
  { value: 'low', description: '低' },
  { value: 'medium', description: '中' },
  { value: 'high', description: '高' },
  { value: 'xhigh', description: '超高' },
  { value: 'max', description: '极高' },
]

/** 旧字符串记录升级为对象时，为已知值补默认描述；未知值直接展示自身。 */
export function defaultReasoningEffortDescription(value: string): string {
  return DEFAULT_REASONING_EFFORT_OPTIONS.find((option) => option.value === value)?.description ?? value
}

/** 开启思考时，max_output_tokens 的下限（为思考 token 预留预算） */
export const REASONING_MIN_OUTPUT_TOKENS = 25_000

/** 用户指定跳过冒烟测试、且默认不启用的上游模型 */
export const EXCLUDED_MODEL_IDS: readonly string[] = ['gpt-5.3-codex-spark', 'codex-auto-review']
