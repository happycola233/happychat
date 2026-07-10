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

/**
 * 内置的聊天标题总结提示词。管理端「系统设置」把它作为已填写的初始值展示，
 * 方便管理员在默认文案基础上直接修改；保存值与它一致时存 null（跟随内置默认）。
 */
export const DEFAULT_TITLE_PROMPT = `I will give you some dialogue content in the \`<content>\` block.
You need to summarize the conversation between user and assistant into a short title.
1. The title language should be consistent with the user's primary language
2. Do not use punctuation or other special symbols
3. Reply directly with the title
4. Summarize using {locale} language
5. The title should not exceed 12 characters

<content>
{content}
</content>`

/** 开启思考时，max_output_tokens 的下限（为思考 token 预留预算） */
export const REASONING_MIN_OUTPUT_TOKENS = 25_000

/** 用户指定跳过冒烟测试、且默认不启用的上游模型 */
export const EXCLUDED_MODEL_IDS: readonly string[] = ['gpt-5.3-codex-spark', 'codex-auto-review']
