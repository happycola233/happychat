import { describe, expect, it } from 'vitest'
import { createAnthropicDefaultHardParams } from '@shared/util/anthropic'
import {
  buildAnthropicBody,
  buildAnthropicMessages,
  mapAnthropicUsage,
  withHistoryCacheBreakpoint,
  type AnthropicMessage,
} from './anthropic'
import type { BuildBodyOptions } from './params'

type ModelRow = BuildBodyOptions['model']

function model(overrides: Partial<ModelRow> = {}): ModelRow {
  return {
    modelId: 'claude-sonnet-5',
    kind: 'anthropic',
    capabilities: {
      vision: true,
      file_input: true,
      web_search: true,
      x_search: false,
      image_generation: false,
      reasoning: true,
      artifacts: false,
    },
    defaultParams: { max_output_tokens: 16000 },
    hardParams: createAnthropicDefaultHardParams(),
    allowedEfforts: [
      { value: 'none', description: '关闭' },
      { value: 'high', description: '高' },
    ],
    defaultEffort: 'high',
    replayProviderContext: true,
    defaultWebSearch: false,
    defaultXSearch: false,
    ...overrides,
  }
}

describe('buildAnthropicMessages', () => {
  it('切换协议时把 commentary 拼在正文前且不发送 phase', () => {
    const messages = buildAnthropicMessages([
      {
        role: 'assistant',
        processSteps: [
          { kind: 'commentary', text: '先核对资料。' },
          { kind: 'commentary', text: '再确认结论。' },
        ],
        content: [{ type: 'output_text', text: '最终回答', phase: 'final_answer' }],
      },
    ])

    expect(messages).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '先核对资料。\n\n再确认结论。' },
          { type: 'text', text: '最终回答' },
        ],
      },
    ])
    expect(JSON.stringify(messages)).not.toContain('phase')
  })

  it('把 runtime context、图片、PDF、文本与原始 assistant blocks 映射为 Messages content', () => {
    const rawAssistant = [
      { type: 'thinking', thinking: '摘要', signature: 'opaque-signature' },
      { type: 'text', text: '原始回答' },
    ]
    const attachments = new Map([
      [
        'image-1',
        {
          dataUrl: 'data:image/png;base64,aW1hZ2U=',
          mime: 'image/png',
          filename: 'image.png',
          kind: 'image' as const,
        },
      ],
      [
        'pdf-1',
        {
          dataUrl: 'data:application/pdf;base64,cGRm',
          mime: 'application/pdf',
          filename: 'doc.pdf',
          kind: 'file' as const,
        },
      ],
      [
        'text-1',
        {
          dataUrl: 'data:text/plain;base64,5L2g5aW9',
          mime: 'text/plain',
          filename: 'note.txt',
          kind: 'file' as const,
        },
      ],
    ])

    const messages = buildAnthropicMessages(
      [
        {
          role: 'user',
          runtimeContext: '<runtime_context>now</runtime_context>',
          content: [
            { type: 'input_text', text: '请阅读' },
            { type: 'input_image', attachment_id: 'image-1' },
            { type: 'input_file', attachment_id: 'pdf-1', filename: 'doc.pdf' },
            { type: 'input_file', attachment_id: 'text-1', filename: 'note.txt' },
          ],
        },
        {
          role: 'assistant',
          content: [{ type: 'output_text', text: '展示文本' }],
          anthropicContent: rawAssistant,
        },
      ],
      attachments,
    )

    expect(messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: '<runtime_context>now</runtime_context>' },
          { type: 'text', text: '请阅读' },
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: 'aW1hZ2U=' },
          },
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: 'cGRm' },
            title: 'doc.pdf',
          },
          {
            type: 'document',
            source: { type: 'text', media_type: 'text/plain', data: '你好' },
            title: 'note.txt',
          },
        ],
      },
      { role: 'assistant', content: rawAssistant },
    ])
  })
})

describe('buildAnthropicBody', () => {
  it.each(['low', 'medium', 'high', 'xhigh', 'max', 'none'])(
    'Opus 5.5 的 %s 选择不会发送 disabled',
    (effort) => {
      const body = buildAnthropicBody({
        model: model({
          modelId: 'claude-opus-5-5',
          hardParams: createAnthropicDefaultHardParams('claude-opus-5-5'),
          allowedEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
          defaultEffort: 'medium',
        }),
        messages: [],
        instructions: null,
        userParams: { reasoning_effort: effort },
        stream: true,
      })
      expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' })
      if (effort !== 'none') expect(body.output_config).toEqual({ effort })
    },
  )

  it('Sonnet 5.5 关闭档发送 between_tools 并固定 high；其他档仍用 adaptive', () => {
    const sonnet = model({
      modelId: 'claude-sonnet-5-5',
      hardParams: createAnthropicDefaultHardParams('claude-sonnet-5-5'),
      allowedEfforts: ['between_tools', 'low', 'high', 'max'],
      defaultEffort: 'high',
    })
    const options = { model: sonnet, messages: [], instructions: null, stream: true }
    const reduced = buildAnthropicBody({
      ...options,
      userParams: { reasoning_effort: 'between_tools' },
    })
    expect(reduced.thinking).toEqual({ type: 'between_tools' })
    expect(reduced.output_config).toEqual({ effort: 'high' })
    expect(
      buildAnthropicBody({ ...options, userParams: { reasoning_effort: 'max' } }),
    ).toMatchObject({ thinking: { type: 'adaptive' }, output_config: { effort: 'max' } })
    expect(() =>
      buildAnthropicBody({
        ...options,
        model: {
          ...sonnet,
          hardParams: { ...sonnet.hardParams, output_config: { effort: 'max' } },
        },
        userParams: { reasoning_effort: 'between_tools' },
      }),
    ).toThrow('思考关闭时 effort 仅支持 low、medium、high')
  })

  it('只在开关开启时应用高级 JSON 中的 thinking 与 web search 模板', () => {
    const base = model()
    const enabled = buildAnthropicBody({
      model: { ...base, defaultWebSearch: true },
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      instructions: 'system',
      userParams: { temperature: 0.5, top_p: 0.5 },
      stream: true,
    })

    expect(enabled).toEqual({
      model: 'claude-sonnet-5',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      stream: true,
      system: 'system',
      max_tokens: 16000,
      cache_control: { type: 'ephemeral' },
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'high' },
      tools: [{ type: 'web_search_20260318', name: 'web_search', allowed_callers: ['direct'] }],
    })
    expect(enabled).not.toHaveProperty('temperature')
    expect(enabled).not.toHaveProperty('top_p')

    const disabled = buildAnthropicBody({
      model: base,
      messages: [],
      instructions: null,
      userParams: { reasoning_effort: 'none', web_search: false },
      stream: true,
    })
    expect(disabled.thinking).toEqual({ type: 'disabled' })
    expect(disabled).not.toHaveProperty('tools')
  })

  it('管理员删除 thinking/web_search 模板后不会暗中补回', () => {
    const customTool = {
      name: 'custom_tool',
      description: 'custom',
      input_schema: { type: 'object' },
    }
    const body = buildAnthropicBody({
      model: model({
        defaultWebSearch: true,
        hardParams: { max_tokens: 4096, tools: [customTool] },
      }),
      messages: [],
      instructions: null,
      userParams: { reasoning_effort: 'high', web_search: true },
      stream: true,
    })

    expect(body).toEqual({
      model: 'claude-sonnet-5',
      messages: [],
      stream: true,
      max_tokens: 4096,
      output_config: { effort: 'high' },
      tools: [customTool],
    })
  })

  it('缺少必填的 max_output_tokens 且高级 JSON 未覆盖时明确拒绝构建请求', () => {
    expect(() =>
      buildAnthropicBody({
        model: model({ defaultParams: null, hardParams: {} }),
        messages: [],
        instructions: null,
        stream: true,
      }),
    ).toThrow('max_output_tokens')
  })

  it('manual thinking 预算不小于最终输出上限时明确拒绝构建请求', () => {
    expect(() =>
      buildAnthropicBody({
        model: model({
          modelId: 'claude-haiku-4-5',
          defaultParams: { max_output_tokens: 4096 },
          hardParams: { thinking: { type: 'enabled', budget_tokens: 8192 } },
          allowedEfforts: [
            { value: 'none', description: '关闭' },
            { value: 'enabled', description: '开启' },
          ],
          defaultEffort: 'enabled',
        }),
        messages: [],
        instructions: null,
        stream: true,
      }),
    ).toThrow('budget_tokens')
  })

  it('manual thinking 的 enabled 档只应用可见模板，不生成非法 effort', () => {
    const body = buildAnthropicBody({
      model: model({
        modelId: 'claude-haiku-4-5',
        hardParams: createAnthropicDefaultHardParams('claude-haiku-4-5'),
        allowedEfforts: [
          { value: 'none', description: '关闭' },
          { value: 'enabled', description: '开启' },
        ],
        defaultEffort: 'enabled',
      }),
      messages: [],
      instructions: null,
      userParams: { temperature: 0.4, top_p: 0.5 },
      stream: true,
    })

    expect(body.thinking).toEqual({
      type: 'enabled',
      budget_tokens: 8192,
      display: 'summarized',
    })
    expect(body).not.toHaveProperty('output_config')
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('top_p')
  })

  it('无默认 effort 时不偷开 thinking，并显式关闭默认思考的 Sonnet 5', () => {
    const sonnetBody = buildAnthropicBody({
      model: model({ defaultEffort: null }),
      messages: [],
      instructions: null,
      stream: true,
    })
    expect(sonnetBody.thinking).toEqual({ type: 'disabled' })
    expect(sonnetBody).not.toHaveProperty('output_config')

    const sonnet46Body = buildAnthropicBody({
      model: model({
        modelId: 'claude-sonnet-4-6',
        hardParams: createAnthropicDefaultHardParams('claude-sonnet-4-6'),
        defaultEffort: null,
      }),
      messages: [],
      instructions: null,
      stream: true,
    })
    expect(sonnet46Body).not.toHaveProperty('thinking')
    expect(sonnet46Body).not.toHaveProperty('output_config')
  })

  it('对所有官方拒绝非默认 sampling 的新型号省略普通采样参数', () => {
    const body = buildAnthropicBody({
      model: model({
        modelId: 'claude-opus-4-7',
        hardParams: createAnthropicDefaultHardParams('claude-opus-4-7'),
      }),
      messages: [],
      instructions: null,
      userParams: { temperature: 0.2, top_p: 0.3 },
      stream: true,
    })

    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('top_p')
  })

  it('允许高级 JSON 覆盖动态 effort，但不会在联网关闭时偷开搜索', () => {
    const body = buildAnthropicBody({
      model: model({
        hardParams: {
          max_tokens: 9000,
          output_config: { effort: 'low' },
          tools: [
            { type: 'web_search_20250305', name: 'web_search', max_uses: 2 },
            { name: 'custom_tool', description: 'custom', input_schema: { type: 'object' } },
          ],
        },
      }),
      messages: [],
      instructions: null,
      userParams: { web_search: false },
      stream: true,
    })

    expect(body.output_config).toEqual({ effort: 'low' })
    expect(body.tools).toEqual([
      { name: 'custom_tool', description: 'custom', input_schema: { type: 'object' } },
    ])
  })
})

describe('withHistoryCacheBreakpoint', () => {
  const history = (): AnthropicMessage[] => [
    { role: 'user', content: [{ type: 'text', text: '第一问' }] },
    { role: 'assistant', content: [{ type: 'text', text: '第一答' }] },
    {
      role: 'user',
      content: [
        { type: 'text', text: '第二问' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW1hZ2U=' } },
      ],
    },
    {
      role: 'assistant',
      content: [
        { type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: { query: 'q' } },
        { type: 'text', text: '第二答' },
      ],
    },
    { role: 'user', content: [{ type: 'text', text: '第三问' }] },
  ]

  it('在上一轮请求末尾的 user block 打上与顶层相同的断点，且不修改传入消息', () => {
    const messages = history()
    const snapshot = structuredClone(messages)
    const cacheControl = { type: 'ephemeral', ttl: '1h' }

    const body = buildAnthropicBody({
      model: model({
        hardParams: { ...createAnthropicDefaultHardParams(), cache_control: cacheControl },
      }),
      messages,
      instructions: null,
      stream: true,
    })

    const marked = body.messages as AnthropicMessage[]
    expect(marked[2]?.content.at(-1)).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'aW1hZ2U=' },
      cache_control: cacheControl,
    })
    expect(JSON.stringify(marked).match(/cache_control/g)).toHaveLength(1)
    expect(messages).toEqual(snapshot)
  })

  it('跳过生成图上下文这类连续 user 消息，只标记紧邻 assistant 之前的那条', () => {
    const messages: AnthropicMessage[] = [
      { role: 'user', content: [{ type: 'text', text: '画一只猫' }] },
      { role: 'assistant', content: [{ type: 'text', text: '已生成' }] },
      { role: 'user', content: [{ type: 'text', text: 'Context: generated image' }] },
      { role: 'user', content: [{ type: 'text', text: '换成橘猫' }] },
    ]

    const marked = withHistoryCacheBreakpoint(messages, { type: 'ephemeral' })

    expect(marked[0]?.content).toEqual([
      { type: 'text', text: '画一只猫', cache_control: { type: 'ephemeral' } },
    ])
    expect(marked.slice(1)).toEqual(messages.slice(1))
  })

  it('pause_turn 续跑时把断点后移到本轮提问并移除旧断点', () => {
    const initial = withHistoryCacheBreakpoint(history(), { type: 'ephemeral' })
    const continued = withHistoryCacheBreakpoint(
      [...initial, { role: 'assistant', content: [{ type: 'text', text: '暂停片段' }] }],
      { type: 'ephemeral' },
    )

    expect(continued[2]).toEqual(history()[2])
    expect(continued[4]?.content).toEqual([
      { type: 'text', text: '第三问', cache_control: { type: 'ephemeral' } },
    ])
  })

  it('首轮请求或顶层未启用缓存时不添加断点', () => {
    const firstTurn: AnthropicMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    ]
    expect(withHistoryCacheBreakpoint(firstTurn, { type: 'ephemeral' })).toEqual(firstTurn)

    const hardParams = { ...createAnthropicDefaultHardParams() }
    delete hardParams.cache_control
    const body = buildAnthropicBody({
      model: model({ hardParams }),
      messages: history(),
      instructions: null,
      stream: true,
    })
    expect(JSON.stringify(body)).not.toContain('cache_control')
  })
})

describe('mapAnthropicUsage', () => {
  it('把普通、缓存写入与缓存读取相加为总输入，thinking 不重复计费', () => {
    expect(
      mapAnthropicUsage({
        input_tokens: 10,
        cache_creation_input_tokens: 20,
        cache_read_input_tokens: 30,
        output_tokens: 40,
        output_tokens_details: { thinking_tokens: 25 },
      }),
    ).toEqual({
      inputTokens: 60,
      cacheWriteTokens: 20,
      cachedTokens: 30,
      outputTokens: 40,
      reasoningTokens: 25,
      totalTokens: 100,
    })
  })
})
