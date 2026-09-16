import { describe, expect, it, vi } from 'vitest'
import { requestPreviewSchema } from '@shared/schemas/request-preview'
import { createAnthropicDefaultHardParams } from '@shared/util/anthropic'
import { buildRequestPreview } from './request-preview'

const provider = {
  baseUrl: 'https://gateway.example.com/v1',
  protocol: 'openai' as const,
  apiKey: 'private-secret',
  extraHeaders: { 'X-Gateway-Token': 'gateway-secret', 'OpenAI-Project': 'project-demo' },
}
const baseModel = { providerId: 'provider-demo', modelId: 'gpt-test', displayName: 'GPT Test' }

describe('upstream request preview', () => {
  it('shows the final merged parameters, fixed streaming and runtime instructions without accessing upstream', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const input = requestPreviewSchema.parse({
      model: {
        ...baseModel,
        defaultSystemPrompt: 'You are {{model_name}}, speaking to {{current_user}}.',
        defaultParams: { temperature: 0.5 },
        hardParams: { temperature: 0.3, stream: false },
      },
      userParams: { temperature: 0.8 },
    })
    const preview = buildRequestPreview(provider, input)
    expect(preview.url).toBe('https://gateway.example.com/v1/responses')
    expect(preview.body).toMatchObject({
      temperature: 0.3,
      stream: true,
      store: false,
      prompt_cache_key: 'happychat:conversation:⟪会话 ID⟫',
    })
    expect(preview.body.instructions).toContain('You are GPT Test')
    expect(preview.body.instructions).toContain('<runtime_context_protocol>')
    expect(preview.parameters.find((p) => p.name === 'temperature')?.source).toBe('高级 JSON')
    expect(preview.parameters.find((p) => p.name === 'stream')?.source).toBe('传输设置')
    expect(preview.headers.authorization).toBe(`Bearer ${provider.apiKey}`)
    expect(preview.headers['x-gateway-token']).toBe('gateway-secret')
    expect(preview.headers['openai-project']).toBe('project-demo')
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
  it('applies the actual web search gating instead of blindly showing a hard-parameter template', () => {
    const model = {
      ...baseModel,
      capabilities: {
        vision: false,
        file_input: false,
        web_search: true,
        x_search: false,
        image_generation: false,
        reasoning: false,
      },
      defaultWebSearch: true,
      hardParams: { tools: [{ type: 'web_search', search_context_size: 'high' }] },
    }
    expect(buildRequestPreview(provider, requestPreviewSchema.parse({ model })).body.tools).toEqual(
      [{ type: 'web_search', search_context_size: 'high' }],
    )
    expect(
      buildRequestPreview(
        provider,
        requestPreviewSchema.parse({ model, userParams: { web_search: false } }),
      ).body,
    ).not.toHaveProperty('tools')
  })
  it('uses Chat Completions message structure and max_tokens migration', () => {
    const result = buildRequestPreview(
      provider,
      requestPreviewSchema.parse({
        model: { ...baseModel, kind: 'chat', hardParams: { max_tokens: 1234 } },
        includeHistory: false,
        includeImage: true,
        includeFile: true,
      }),
    )
    expect(result.url).toMatch(/\/chat\/completions$/)
    expect(result.body).toMatchObject({
      max_completion_tokens: 1234,
      stream_options: { include_usage: true },
    })
    expect(result.body).not.toHaveProperty('max_tokens')
    expect(JSON.stringify(result.body.messages)).toContain('data:image/png;base64,⟪图片内容⟫')
    expect(JSON.stringify(result.body.messages)).toContain('document.pdf')
  })
  it('uses Anthropic system, messages and thinking rules', () => {
    const input = requestPreviewSchema.parse({
      model: {
        ...baseModel,
        kind: 'anthropic',
        modelId: 'claude-sonnet-5',
        defaultParams: { max_output_tokens: 16000 },
        hardParams: createAnthropicDefaultHardParams(),
        capabilities: {
          vision: true,
          file_input: true,
          web_search: true,
          x_search: false,
          image_generation: false,
          reasoning: true,
        },
        allowedEfforts: [{ value: 'high', description: '高' }],
        defaultEffort: 'high',
      },
      includeImage: true,
      includeFile: true,
    })
    const result = buildRequestPreview({ ...provider, protocol: 'anthropic' }, input)
    expect(result.url).toBe('https://gateway.example.com/v1/messages')
    expect(result.headers['x-api-key']).toBe(provider.apiKey)
    expect(result.headers).not.toHaveProperty('authorization')
    expect(result.body).toMatchObject({ max_tokens: 16000, output_config: { effort: 'high' } })
    expect(result.body.system).toContain('runtime_context_protocol')
    expect(JSON.stringify(result.body.messages)).toContain('"media_type":"application/pdf"')
  })
  it('switches Images endpoints for reference images and keeps image overrides', () => {
    const input = requestPreviewSchema.parse({
      model: {
        ...baseModel,
        kind: 'image',
        defaultParams: { image: { size: '1024x1024', background: 'transparent' } },
      },
      includeImage: true,
      userParams: { image: { quality: 'high' } },
    })
    const result = buildRequestPreview(provider, input)
    expect(result.url).toMatch(/\/images\/edits$/)
    expect(result.body).toMatchObject({
      n: 1,
      size: '1024x1024',
      quality: 'high',
      images: [{ image_url: 'data:image/png;base64,⟪参考图内容⟫' }],
    })
    expect(result.body).not.toHaveProperty('stream')
    expect(result.body.prompt).toBe('⟪本次用户消息中的图片描述⟫')
    expect(result.parameters.find((parameter) => parameter.name === 'size')?.source).toBe(
      '模型默认 · 协议规则',
    )
    expect(result.parameters.find((parameter) => parameter.name === 'background')?.source).toBe(
      '模型默认 · 协议规则',
    )
    expect(result.parameters.find((parameter) => parameter.name === 'quality')?.source).toBe(
      '用户参数',
    )
    expect(result.notes.some((note) => note.includes('不携带历史对话文字'))).toBe(true)
    expect(buildRequestPreview(provider, { ...input, includeImage: false }).url).toMatch(
      /\/images\/generations$/,
    )
  })
  it('explains configured fields that the selected protocol omits', () => {
    const input = requestPreviewSchema.parse({
      model: {
        ...baseModel,
        kind: 'anthropic',
        modelId: 'claude-sonnet-5',
        defaultParams: { max_output_tokens: 16000, temperature: 0.7, verbosity: 'high' },
      },
    })
    const result = buildRequestPreview({ ...provider, protocol: 'anthropic' }, input)
    expect(result.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'temperature', source: '本次不发送' }),
        expect.objectContaining({ name: 'verbosity', source: '本次不发送' }),
      ]),
    )
    expect(result.body).not.toHaveProperty('temperature')
  })
  it('preserves the actual configured URL, headers and nested body in the administrator preview', () => {
    const secretProvider = {
      ...provider,
      baseUrl: 'https://admin:password-value@gateway.example.com/v1?api_key=query-secret',
      extraHeaders: {
        'X-Auth': 'opaque-auth-value',
        'Ocp-Apim-Subscription-Key': 'subscription-value',
      },
    }
    const input = requestPreviewSchema.parse({
      model: {
        ...baseModel,
        hardParams: {
          tools: [
            {
              type: 'mcp',
              server_label: 'demo',
              authorization: 'Bearer mcp-secret',
              server_url: 'https://user:tool-password@tool.example.com/mcp?token=tool-secret',
              headers: { 'X-Opaque': 'tool-header-secret' },
            },
          ],
          metadata: { echo: `prefix ${provider.apiKey} suffix`, arbitrary: 'opaque-auth-value' },
          max_output_tokens: 2000,
        },
      },
    })
    const result = buildRequestPreview(secretProvider, input)
    const serialized = JSON.stringify(result)
    for (const secret of [
      'password-value',
      'query-secret',
      'opaque-auth-value',
      'subscription-value',
      'mcp-secret',
      'tool-password',
      'tool-secret',
      'tool-header-secret',
      provider.apiKey,
    ])
      expect(serialized).toContain(secret)
    expect(result.url).toBe(`${secretProvider.baseUrl}/responses`)
    expect(result.headers['x-auth']).toBe('opaque-auth-value')
    expect(result.headers['ocp-apim-subscription-key']).toBe('subscription-value')
    expect(result.body.max_output_tokens).toBe(2000)
    expect(result.headers['content-type']).toBe('application/json')
    expect(result.body.tools).toEqual([
      {
        type: 'mcp',
        server_label: 'demo',
        authorization: 'Bearer mcp-secret',
        server_url: 'https://user:tool-password@tool.example.com/mcp?token=tool-secret',
        headers: { 'X-Opaque': 'tool-header-secret' },
      },
    ])
    expect(input.model.hardParams?.metadata).toEqual({
      echo: `prefix ${provider.apiKey} suffix`,
      arbitrary: 'opaque-auth-value',
    })
  })
})
