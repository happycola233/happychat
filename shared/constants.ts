import type { ReasoningEffort } from './types/domain'

/** 会话 cookie 名 */
export const SESSION_COOKIE = 'hc_session'

/** 会话有效期（毫秒）：30 天 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** 所有可能的思考等级（具体某模型允许哪些由 models.allowed_efforts 决定） */
export const REASONING_EFFORTS: readonly ReasoningEffort[] = [
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
]

/** 开启思考时，max_output_tokens 的下限（为思考 token 预留预算） */
export const REASONING_MIN_OUTPUT_TOKENS = 25_000

/** 用户指定跳过冒烟测试、且默认不启用的上游模型 */
export const EXCLUDED_MODEL_IDS: readonly string[] = ['gpt-5.3-codex-spark', 'codex-auto-review']
