import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { exportOptionsSchema } from '@shared/schemas/export'
import { DEFAULT_CONTEXT_POLICY } from '@shared/util/contextPolicy'
import { buildChatlogMd } from './chatlog-md'
import type { ExportMessage, ExportSource } from './types'

const stamp = Date.parse('2026-09-19T16:30:24Z')

function message(fields: Partial<ExportMessage> = {}): ExportMessage {
  return {
    id: 'message-example',
    conversationId: 'conversation-example',
    parentId: null,
    role: 'assistant',
    status: 'complete',
    modelId: 'internal-model-uuid',
    modelLabel: '示例模型',
    runId: null,
    createdAt: stamp,
    content: [{ type: 'output_text', text: '回答正文' }],
    processSteps: [],
    reasoningDurationMs: null,
    generationDurationMs: null,
    annotations: null,
    usage: null,
    errorMessage: null,
    ...fields,
  }
}

function source(messages = [message()]): ExportSource {
  return {
    title: '虚构的导出示例',
    timezone: 'Asia/Shanghai',
    exportedAt: stamp,
    conversation: {
      id: 'conversation-example',
      title: '虚构的导出示例',
      modelId: null,
      folderId: null,
      activeLeafId: null,
      pinnedAt: null,
      createdAt: stamp,
      updatedAt: stamp,
      contextPolicy: DEFAULT_CONTEXT_POLICY,
    },
    messages,
    activeLeafId: null,
    attachments: new Map(),
  }
}

function metadata(text: string): Record<string, unknown>[] {
  return [...text.matchAll(/^<!-- @meta\n([\s\S]*?)^-->/gm)].map(
    (match) => parse(match[1]!) as Record<string, unknown>,
  )
}

const options = exportOptionsSchema.parse({ format: 'chatlog-md', includeUsage: true })

describe('chatlog-md/2 构建器', () => {
  it.each(['a\u2028b.txt', 'a\u2029b.txt'])('Unicode 分隔符文件名 %j 用结构化附件保留', (name) => {
    const text = buildChatlogMd(
      source([
        message({
          content: [{ type: 'input_file', attachment_id: 'missing-file', filename: name }],
        }),
      ]),
      { ...options, attachmentMode: 'name' },
    )
    expect(metadata(text)[1]).toEqual({ kind: 'file', name, path: null })
  })

  it('来源显示列表去重，结构化记录保留每次引用的位置且不会混入个人批注', () => {
    const records = [
      {
        type: 'url_citation' as const,
        title: '第一次引用',
        url: 'https://example.com/a',
        start_index: 0,
        end_index: 2,
      },
      {
        type: 'url_citation' as const,
        title: '第二次引用',
        url: 'https://example.com/a',
        start_index: 4,
        end_index: 6,
      },
    ]
    const data = source([message({ annotations: records })])
    const text = buildChatlogMd(data, options)
    expect(metadata(text)[1]).toEqual({ results: records })
    expect(text).toContain('@part x-citations')
    expect(text).toContain('1. [第一次引用]')
    expect(text).not.toContain('2. [第二次引用]')
    expect(metadata(text)[0]).not.toHaveProperty('annotations')
    expect(buildChatlogMd(data, { ...options, includeCitations: false })).not.toContain(
      'https://example.com/a',
    )
  })

  it.each(['true', '.nan', '0123', '2026-09-20', '含冒号: 与换行\n---\n标题', '标题\u0000末尾'])(
    '文档标题 %j 始终保持原字符串',
    (title) => {
      const text = buildChatlogMd({ ...source(), title }, options)
      const head = parse(text.slice(4, text.indexOf('\n---', 4))) as Record<string, unknown>
      expect(head).toMatchObject({ format: 'chatlog-md/2', title, timezone: 'Asia/Shanghai' })
      expect(Object.keys(head)).toEqual(['format', 'title', 'timezone', 'x-happychat'])
    },
  )

  it('真实模型与数字用量直接使用原始快照，保留 0 和不一致总量', () => {
    const text = buildChatlogMd(
      source([
        message({
          chatlogMetadata: {
            model: { id: 'example-model', name: '模型 · "特别版"\n-->' },
            reasoning: { effort: 'future-effort' },
            usage: {
              input_tokens: 1200,
              output_tokens: 300,
              cache_read_tokens: 800,
              cache_write_tokens: 0,
              reasoning_tokens: 100,
              total_tokens: 1501,
            },
          },
          generationDurationMs: 0,
          reasoningDurationMs: 8000,
        }),
      ]),
      options,
    )
    expect(metadata(text)[0]).toEqual({
      id: 'message-example',
      model: { id: 'example-model', name: '模型 · "特别版"\n-->' },
      reasoning: { effort: 'future-effort' },
      usage: {
        input_tokens: 1200,
        output_tokens: 300,
        cache_read_tokens: 800,
        cache_write_tokens: 0,
        reasoning_tokens: 100,
        total_tokens: 1501,
      },
      'x-generation': { status: 'complete', duration_ms: 0, reasoning_duration_ms: 8000 },
    })
    expect(text).not.toContain('internal-model-uuid')
    expect(text).toContain('--\\u003e')
  })

  it('按原序保留所有过程，思考与搜索开关独立', () => {
    const data = source([
      message({
        processSteps: [
          { kind: 'reasoning', text: '第一段思考' },
          { kind: 'commentary', text: '检索说明' },
          {
            kind: 'search',
            action: { type: 'search', queries: ['甲', '乙'], error: 'unavailable' },
          },
          { kind: 'reasoning', text: '第二段思考' },
          { kind: 'search', action: { type: 'open_page', url: 'https://example.com' } },
          {
            kind: 'search',
            action: { type: 'find_in_page', url: 'https://example.com', pattern: '目标' },
          },
          {
            kind: 'search',
            action: {
              type: 'x_keyword_search',
              queries: ['测试'],
              handles: ['example'],
              excludedHandles: ['excluded'],
              fromDate: '2026-01-01',
              toDate: '2026-02-01',
              mode: 'Latest',
            },
          },
          { kind: 'search', action: { type: 'x_thread_fetch', postId: '1234567890123456789' } },
        ],
        reasoningDurationMs: 18000,
      }),
    ])
    const text = buildChatlogMd(data, options)
    expect([...text.matchAll(/^<!-- @part ([\w-]+) -->/gm)].map((match) => match[1])).toEqual([
      'reasoning',
      'commentary',
      'search',
      'reasoning',
      'open_page',
      'find_in_page',
      'search',
      'search',
      'answer',
    ])
    const actions = metadata(text)
      .filter((meta) => meta.action)
      .map((meta) => meta.action)
    expect(actions).toEqual(
      data.messages[0]!.processSteps.filter((step) => step.kind === 'search').map(
        (step) => step.action,
      ),
    )
    expect(metadata(text).filter((meta) => 'duration_ms' in meta)).toEqual([])
    const noReasoning = buildChatlogMd(data, { ...options, includeReasoning: false })
    expect(noReasoning).not.toContain('@part reasoning')
    expect(noReasoning).not.toContain('@part commentary')
    expect(noReasoning).toContain('@part search')
    const noSearch = buildChatlogMd(data, { ...options, includeSearch: false })
    expect(noSearch).not.toContain('@part search')
    expect(noSearch).not.toContain('@part open_page')
    expect(noSearch).toContain('@part commentary')
  })

  it('正文和附件交错，特殊名称与长生成提示词完整保留', () => {
    const prompt = '虚构提示 "带引号"\n-->\n'.repeat(40)
    const data = source([
      message({
        content: [
          { type: 'output_text', text: '第一段  \n    缩进' },
          { type: 'input_file', attachment_id: 'file', filename: '[原名]\n笔记.txt' },
          { type: 'output_text', text: '第二段' },
          { type: 'image_result', attachment_id: 'image', revised_prompt: prompt },
          { type: 'output_text', text: '最后一段' },
        ],
      }),
    ])
    data.attachments.set('image', {
      id: 'image',
      kind: 'image',
      mime: 'image/png',
      filename: '生成图 #1.png',
      byteSize: 3,
      assetPath: 'assets/生成图 #1.png',
      data: new Uint8Array([1, 2, 3]),
      missing: false,
    })
    const text = buildChatlogMd(data, options)
    expect([...text.matchAll(/^<!-- @part ([\w-]+) -->/gm)].map((match) => match[1])).toEqual([
      'answer',
      'attachment',
      'answer',
      'attachment',
      'answer',
    ])
    expect(text).toContain('第一段  \n    缩进')
    const attachments = metadata(text).filter((meta) => meta.kind)
    expect(attachments).toEqual([
      { kind: 'file', name: '[原名]\n笔记.txt', path: null },
      {
        kind: 'image',
        name: '生成图 #1.png',
        path: 'assets/生成图%20%231.png',
        meta: { 'x-generation': { generated: true, revised_prompt: prompt } },
      },
    ])
    expect(buildChatlogMd(data, { ...options, attachmentMode: 'name' })).not.toContain('assets/')
    const omitted = buildChatlogMd(data, { ...options, attachmentMode: 'omit' })
    expect(omitted).not.toContain('@part attachment')
    expect(omitted).not.toContain('revised_prompt')
    expect(omitted).toContain('第二段')
  })

  it.each(['second', 'minute', 'day', 'none'] as const)(
    '时间精度 %s 不重排跨日记录',
    (timePrecision) => {
      const data = source([
        message({ id: 'a', role: 'system' }),
        message({ id: 'b', role: 'user', createdAt: stamp - 86400000 }),
        message({ id: 'c' }),
      ])
      const text = buildChatlogMd(data, { ...options, timePrecision })
      const headers = text.split('\n').filter((line) => line.startsWith('## '))
      const time =
        timePrecision === 'second' ? ' 00:30:24' : timePrecision === 'minute' ? ' 00:30' : ''
      const suffix = timePrecision === 'none' ? '' : ` · 2026-09-20${time}`
      expect(headers[0]).toBe(`## ⚙️ @system${suffix}`)
      expect(metadata(text).map((meta) => meta.id)).toEqual(['a', 'b', 'c'])
      expect(text.split('\n').filter((line) => line.startsWith('# @'))).toEqual(
        timePrecision === 'none' ? [] : ['# @2026-09-20', '# @2026-09-19', '# @2026-09-20'],
      )
    },
  )

  it('关闭模型、推理、用量后不泄露对应字段，仍保留异常状态与原始错误', () => {
    const error = '错误 "原因"\n-->\n下一行'
    const text = buildChatlogMd(
      source([
        message({
          status: 'error',
          errorMessage: error,
          chatlogMetadata: {
            model: { id: 'example' },
            reasoning: { effort: 'high' },
            usage: { total_tokens: 0 },
          },
          generationDurationMs: 3000,
          reasoningDurationMs: 1000,
        }),
      ]),
      { ...options, includeModel: false, includeReasoning: false, includeUsage: false },
    )
    expect(metadata(text)[0]).toEqual({
      id: 'message-example',
      'x-generation': { status: 'error', error },
    })
  })

  it('截断 Markdown 补齐结构，同时保存完整原文供恢复', () => {
    const original = '尚未生成完\n```ts\nconst unfinished = 1'
    const text = buildChatlogMd(
      source([message({ content: [{ type: 'output_text', text: original }] })]),
      options,
    )
    expect(metadata(text)[1]).toEqual({ 'x-happychat': { original_text: original } })
    expect(text).toContain('const unfinished = 1\n```\n<!-- @endpart -->')
  })
})
