import type { RequestPreviewInput } from '@shared/schemas/request-preview'
import type { RequestPreviewDTO } from '@shared/types/request-preview'
import type { ProviderProtocol } from '@shared/types/domain'
import { PROMPT_VARIABLES, renderPromptTemplate } from '@shared/util/promptTemplate'
import { joinAnthropicUrl, joinBaseUrl } from '@shared/util/url'
import { appendRuntimeContextInstructions } from '../runs/runtimeContext'
import { buildAnthropicBody, buildAnthropicMessages } from './anthropic'
import { buildChatBody, buildChatMessages } from './chat'
import { buildInput, type PathMessage, type ResolvedAttachment } from './context'
import {
  buildImageBody,
  buildImageEditBody,
  buildResponseBody,
  type RequestModelConfig,
} from './params'
import { buildProviderHeaders } from './request-headers'

type PreviewProvider = {
  baseUrl: string
  apiKey: string
  protocol: ProviderProtocol
  extraHeaders: Record<string, string>
}

const USER_PARAMETER_KEYS: Record<string, string> = {
  text: 'verbosity',
  reasoning: 'reasoning_effort',
  output_config: 'reasoning_effort',
  thinking: 'reasoning_effort',
  max_tokens: 'max_output_tokens',
  max_completion_tokens: 'max_output_tokens',
}
const DYNAMIC_FIELDS = new Set(['input', 'messages', 'prompt', 'images', 'prompt_cache_key'])

/** 使用真实发送链路的构建器；动态上下文用明确占位符替代，绝不读取用户聊天或发起上游请求。 */
export function buildRequestPreview(
  provider: PreviewProvider,
  input: RequestPreviewInput,
): RequestPreviewDTO {
  const draft = input.model
  const model: RequestModelConfig = {
    ...draft,
    defaultParams: draft.defaultParams ?? null,
    hardParams: draft.hardParams ?? null,
    defaultEffort: draft.defaultEffort ?? null,
  }
  const variables = Object.fromEntries(
    PROMPT_VARIABLES.map(({ name, description }) => [name, `⟪${description}⟫`]),
  )
  variables.model_name = draft.displayName
  variables.model_id = draft.modelId
  const instructions = appendRuntimeContextInstructions(
    draft.defaultSystemPrompt ? renderPromptTemplate(draft.defaultSystemPrompt, variables) : null,
  )
  const messages: PathMessage[] = input.includeHistory
    ? [
        {
          role: 'user',
          content: [{ type: 'input_text', text: '⟪按上下文保留规则选中的历史用户消息⟫' }],
        },
        { role: 'assistant', content: [{ type: 'output_text', text: '⟪历史助手回复⟫' }] },
      ]
    : []
  const current: PathMessage = {
    role: 'user',
    runtimeContext:
      '<runtime_context>\ndatetime: ⟪消息发送时间⟫\ntimezone: ⟪用户时区⟫\n</runtime_context>',
    content: [{ type: 'input_text', text: '⟪本次用户消息⟫' }],
  }
  const attachments = new Map<string, ResolvedAttachment>()
  if (input.includeImage) {
    current.content.push({ type: 'input_image', attachment_id: 'preview-image' })
    attachments.set('preview-image', {
      dataUrl: 'data:image/png;base64,⟪图片内容⟫',
      filename: 'reference.png',
      mime: 'image/png',
      kind: 'image',
    })
  }
  if (input.includeFile && model.kind !== 'image') {
    current.content.push({
      type: 'input_file',
      attachment_id: 'preview-file',
      filename: 'document.pdf',
    })
    attachments.set('preview-file', {
      dataUrl: 'data:application/pdf;base64,⟪文件内容⟫',
      filename: 'document.pdf',
      mime: 'application/pdf',
      kind: 'file',
    })
  }
  messages.push(current)
  const shared = { model, userParams: input.userParams, stream: true }
  const promptCacheKey = 'happychat:conversation:⟪会话 ID⟫'
  let path: string
  let body: Record<string, unknown>
  if (model.kind === 'image') {
    path = input.includeImage ? '/images/edits' : '/images/generations'
    const prompt = '⟪本次用户消息中的图片描述⟫'
    body = input.includeImage
      ? buildImageEditBody(model, prompt, ['data:image/png;base64,⟪参考图内容⟫'], input.userParams)
      : buildImageBody(model, prompt, input.userParams)
  } else if (model.kind === 'anthropic') {
    path = '/v1/messages'
    body = buildAnthropicBody({
      ...shared,
      instructions,
      messages: buildAnthropicMessages(messages, attachments),
    })
  } else if (model.kind === 'chat') {
    path = '/chat/completions'
    body = buildChatBody({
      ...shared,
      messages: buildChatMessages(messages, attachments, instructions),
      promptCacheKey,
    })
  } else {
    path = '/responses'
    body = buildResponseBody({
      ...shared,
      input: buildInput(messages, attachments),
      instructions,
      promptCacheKey,
    })
  }
  // 三种文本客户端会在最终发送时强制 stream=true，高级 JSON 不会关闭 SSE。
  if (model.kind !== 'image') body.stream = true
  const parameters = Object.keys(body).map((name) => {
    const hardValue =
      model.hardParams?.[name] ??
      (name === 'max_completion_tokens' ? model.hardParams?.max_tokens : undefined)
    const userKey = USER_PARAMETER_KEYS[name] ?? name
    const imageKey = name === 'size' || name === 'quality' || name === 'background' ? name : null
    const userValue = imageKey
      ? input.userParams?.image?.[imageKey]
      : input.userParams?.[userKey as keyof typeof input.userParams]
    const defaultValue = imageKey
      ? model.defaultParams?.image?.[imageKey]
      : model.defaultParams?.[userKey as keyof NonNullable<typeof model.defaultParams>]
    if (name === 'stream' && model.kind !== 'image')
      return {
        name,
        source: '传输设置',
        description: '文本响应使用 SSE 流式传输，发送前固定为 true。',
      }
    if (name === 'tools')
      return {
        name,
        source: '工具开关 · 高级 JSON',
        description:
          '联网与 X 搜索按当前开关保留或移除，再合并工具模板；其他工具按高级 JSON 发送。',
      }
    if (hardValue !== undefined)
      return {
        name,
        source: '高级 JSON',
        description:
          name === 'thinking' || name === 'include'
            ? '按能力、思考开关与协议规则合并后得到此值。'
            : '高级 JSON 优先于用户参数与模型默认。',
      }
    if (DYNAMIC_FIELDS.has(name))
      return {
        name,
        source: '动态上下文',
        description: '实际发送时填入当前会话选中的消息、附件或会话标识。',
      }
    if (name === 'instructions' || name === 'system')
      return {
        name,
        source: '系统提示词 · 运行环境',
        description: '渲染模型提示词变量，并附加固定的运行环境说明。',
      }
    if (userValue !== undefined)
      return {
        name,
        source: '用户参数',
        description: name.startsWith('max_')
          ? '采用本次参数；启用 OpenAI 思考时会保证最低输出预算。'
          : '采用本次模拟的用户选择。',
      }
    if (
      defaultValue !== undefined ||
      ['reasoning', 'reasoning_effort', 'thinking', 'output_config'].includes(name)
    )
      return {
        name,
        source: '模型默认 · 协议规则',
        description: '采用模型默认值，并应用当前能力与协议映射。',
      }
    return {
      name,
      source: '应用默认',
      description:
        name === 'model'
          ? '提供商接收的上游模型 ID。'
          : name === 'store'
            ? '默认不在上游保存响应，本地管理上下文。'
            : '应用构建请求时设置的默认值。',
    }
  })
  const notes = [
    '预览按当前未保存的配置构建，不发送请求，也不产生费用。',
    '⟪…⟫ 表示发送时填入的内容；实际历史长度、附件、用户参数以当次会话为准。',
    '自动重试属于传输设置，不会添加到上游请求体；可在系统设置中调整。',
  ]
  // 同样展示被协议规则省略的已配置参数，避免管理员只看到缺失却不知道原因。
  const configuredParams = { ...model.defaultParams, ...input.userParams }
  for (const name of ['temperature', 'top_p'] as const) {
    if (configuredParams[name] !== undefined && body[name] === undefined) {
      parameters.push({
        name,
        source: '本次不发送',
        description:
          model.kind === 'anthropic'
            ? '当前 Anthropic 型号或思考模式不接受此采样参数。高级 JSON 中的显式值仍可覆盖此规则。'
            : '当前图片请求不使用文本采样参数。',
      })
    }
  }
  if (configuredParams.verbosity !== undefined && model.kind !== 'responses') {
    parameters.push({
      name: 'verbosity',
      source: '本次不发送',
      description: '此默认参数仅映射到 Responses 的 text.verbosity。',
    })
  }
  if (model.kind === 'image') {
    notes.push(
      'Images API 只发送本次用户消息中的文字与所选参考图，不携带历史对话文字或默认系统提示词。',
    )
  }
  if (model.kind === 'chat') {
    notes.push('默认系统提示词与固定运行环境说明作为 messages 中的 system 消息发送。')
  }
  if (
    model.replayProviderContext &&
    input.includeHistory &&
    ['responses', 'anthropic'].includes(model.kind)
  )
    notes.push(
      '已开启私有上下文回传：符合提供商、地址与模型匹配条件的加密推理或原始 assistant blocks 会随历史一起发送，预览不含这些私有内容。',
    )
  if (model.kind === 'anthropic')
    notes.push(
      'Anthropic 的 thinking、采样参数与联网工具会按该型号和开关调整；这里展示调整后的结果。',
    )
  return {
    method: 'POST',
    url:
      model.kind === 'anthropic'
        ? joinAnthropicUrl(provider.baseUrl, '/v1/messages')
        : joinBaseUrl(provider.baseUrl, path),
    headers: buildProviderHeaders(provider.protocol, provider.apiKey, provider.extraHeaders, true),
    body,
    parameters,
    notes,
  }
}
