/**
 * 使用指定 dialogary 工作区的真实读取器核验 V2 导出，全部输入均为内存中的虚构数据。
 * 运行：npx tsx scripts/verify-chatlog-v2.ts <dialogary目录>
 * 不读取聊天数据库、私人日记或凭据，不向磁盘写入导出文件。
 */
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  EXPORT_ATTACHMENT_MODES,
  EXPORT_TIME_PRECISIONS,
  exportOptionsSchema,
  type ExportOptions,
} from '../shared/schemas/export'
import type { ContentPart, UrlCitation } from '../shared/types/domain'
import { buildChatlogMd } from '../server/export/chatlog-md'
import type { ExportMessage, ExportSource } from '../server/export/types'

type Metadata = Record<string, unknown>
interface ParsedPart {
  kind: string
  text?: string
  data?: Metadata
}
interface ParsedAttachment {
  kind: 'image' | 'file'
  name: string
  path: string | null
  meta: Metadata
}
interface ParsedMessage {
  role: string
  id?: string
  time: string | null
  timePrecision: string | null
  model: string | null
  modelInfo?: Metadata
  usage?: Metadata
  meta: Metadata
  parts: ParsedPart[]
  attachments: ParsedAttachment[]
}
interface ParsedDocument {
  format: string | null
  meta: Metadata
  sessions: { date: string | null; messages: ParsedMessage[] }[]
  issues: { level: string; rule: string; message: string }[]
}
interface Reader {
  parseChatlog(text: string): ParsedDocument
  serializeChatlog(document: ParsedDocument): string
}
interface ExpectedPart extends ParsedPart {
  attachment?: ParsedAttachment
}

const stamp = Date.parse('2026-09-19T16:30:24Z')
const safeCitations: UrlCitation[] = [
  {
    type: 'url_citation',
    url: 'https://example.test/article',
    title: '虚构资料',
    start_index: 0,
    end_index: 2,
  },
  {
    type: 'url_citation',
    url: 'https://example.test/article',
    title: '同一资料另一处引用',
    start_index: 5,
    end_index: 8,
  },
]
const citations: UrlCitation[] = [
  ...safeCitations,
  {
    type: 'url_citation',
    url: 'javascript:invalid-test-url',
    title: '应剔除的测试地址',
    start_index: 9,
    end_index: 10,
  },
]
const generatedPrompt = '完全虚构的图片提示，保留 "引号" 和换行\n-->\n'.repeat(12)
const assetCases = [
  {
    id: 'image',
    kind: 'image' as const,
    name: '参考图 #1%(v2).png',
    path: 'assets/参考图 #1%(v2).png',
    encodedPath: 'assets/参考图%20%231%25%28v2%29.png',
    missing: false,
  },
  {
    id: 'file',
    kind: 'file' as const,
    name: ' [虚构笔记]\n草稿.txt ',
    path: 'assets/笔记 %2.txt',
    encodedPath: 'assets/笔记%20%252.txt',
    missing: false,
  },
  {
    id: 'missing',
    kind: 'image' as const,
    name: '缺失的虚构图片.png',
    path: null,
    encodedPath: null,
    missing: true,
  },
  {
    id: 'generated',
    kind: 'image' as const,
    name: '生成图.png',
    path: 'assets/生成图.png',
    encodedPath: 'assets/生成图.png',
    missing: false,
  },
  {
    id: 'separators',
    kind: 'file' as const,
    name: '分隔\u2028\u2029笔记.txt',
    path: 'assets/分隔笔记.txt',
    encodedPath: 'assets/分隔笔记.txt',
    missing: false,
  },
]

function message(
  id: string,
  role: ExportMessage['role'],
  content: ContentPart[],
  fields: Partial<ExportMessage> = {},
): ExportMessage {
  return {
    id,
    role,
    content,
    conversationId: 'synthetic-conversation',
    parentId: null,
    status: 'complete',
    modelId: null,
    modelLabel: null,
    runId: null,
    processSteps: [],
    reasoningDurationMs: null,
    generationDurationMs: null,
    annotations: null,
    usage: null,
    errorMessage: null,
    createdAt: stamp,
    ...fields,
  }
}

function source(messages: ExportMessage[], title = '完全虚构的 V2 互操作验证'): ExportSource {
  return {
    title,
    timezone: 'Asia/Shanghai',
    exportedAt: stamp,
    messages,
    activeLeafId: null,
    conversation: {
      id: 'synthetic-conversation',
      title,
      modelId: null,
      folderId: null,
      activeLeafId: null,
      pinnedAt: null,
      createdAt: stamp,
      updatedAt: stamp,
      contextPolicy: {
        historyTurns: null,
        uploads: { mode: 'all' },
        generatedImages: { mode: 'all' },
      },
    },
    attachments: new Map(
      assetCases.map((asset) => [
        asset.id,
        {
          id: asset.id,
          kind: asset.kind,
          filename: asset.name,
          mime: asset.kind === 'image' ? 'image/png' : 'text/plain',
          byteSize: 3,
          assetPath: asset.path,
          data: null,
          missing: asset.missing,
        },
      ]),
    ),
  }
}

const fixture = source([
  message('system-example', 'system', [{ type: 'input_text', text: '这是虚构的系统说明。' }]),
  message(
    'user-example',
    'user',
    [
      {
        type: 'input_text',
        text: '# @2099-01-01\n## 🤖 @ai\n<!-- @part answer -->\n\\<!-- @endpart -->\n🖼️ 这行是正文\n> 🤔 普通引用',
      },
      { type: 'input_image', attachment_id: 'image' },
      { type: 'input_text', text: '\n\r\n  保留外围空行和硬换行  \r\n' },
      { type: 'input_file', attachment_id: 'file', filename: '不会替换附件的原名.txt' },
      { type: 'input_image', attachment_id: 'missing' },
      { type: 'input_file', attachment_id: 'separators', filename: '分隔符文件.txt' },
      { type: 'input_text', text: '<!-- 未写完的普通注释\n```md' },
    ],
    { createdAt: stamp - 86_400_000 },
  ),
  message(
    'assistant-example',
    'assistant',
    [
      {
        type: 'output_text',
        text: '第一段回答  \n    保留缩进',
        annotations: citations,
        phase: 'final_answer',
      },
      { type: 'image_result', attachment_id: 'generated', revised_prompt: generatedPrompt },
      { type: 'output_text', text: '停止时的代码\n````ts\nconst unfinished =\n```' },
    ],
    {
      modelId: 'internal-model-configuration-id',
      modelLabel: '当前名称不应替代历史快照',
      status: 'interrupted',
      errorMessage: '虚构中断原因\n-->\n完整保留',
      reasoningDurationMs: 8000,
      generationDurationMs: 0,
      annotations: citations,
      processSteps: [
        { kind: 'reasoning', text: '第一段思考\n<!-- @meta\n字面示例' },
        { kind: 'commentary', text: '开始查找虚构资料。' },
        {
          kind: 'search',
          action: { type: 'search', queries: ['示例一', '示例二'], error: 'synthetic-error' },
        },
        { kind: 'reasoning', text: '第二段思考\r\n保留原换行。' },
        { kind: 'search', action: { type: 'open_page', url: 'https://example.test/article' } },
        {
          kind: 'search',
          action: {
            type: 'find_in_page',
            url: 'https://example.test/article',
            pattern: '虚构关键词',
          },
        },
        {
          kind: 'search',
          action: {
            type: 'x_keyword_search',
            queries: ['虚构话题'],
            handles: ['example'],
            excludedHandles: ['excluded'],
            fromDate: '2026-09-01',
            toDate: '2026-09-21',
            mode: 'Latest',
          },
        },
      ],
      chatlogMetadata: {
        model: { id: 'example-upstream-model', name: '快照名称 · "特别版"\n-->' },
        reasoning: { effort: 'future-effort' },
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_read_tokens: 0,
          cache_write_tokens: 10,
          reasoning_tokens: 5,
          total_tokens: 121,
        },
      },
    },
  ),
  message(
    'partial-usage-example',
    'assistant',
    [{ type: 'output_text', text: '只有部分用量的虚构回复。' }],
    {
      chatlogMetadata: { usage: { output_tokens: 0 } },
    },
  ),
])

/** 扩展原文优先；显示用的围栏补齐与读取器空白规范化都不得改写导出原始内容。 */
function restoredText(part: ParsedPart): string {
  const original = (part.data?.['x-happychat'] as { original_text?: string } | undefined)
    ?.original_text
  return original ?? part.text ?? ''
}

function expectedParts(original: ExportMessage, options: ExportOptions): ExpectedPart[] {
  const parts: ExpectedPart[] = []
  for (const step of original.processSteps) {
    if (step.kind === 'search') {
      if (!options.includeSearch) continue
      const kind = ['open_page', 'find_in_page'].includes(step.action.type)
        ? step.action.type
        : 'search'
      parts.push({ kind, data: { action: step.action } })
    } else if (options.includeReasoning) parts.push({ kind: step.kind, text: step.text })
  }
  for (const part of original.content) {
    if (part.type === 'input_text' || part.type === 'output_text') {
      const data: Metadata = {}
      if (part.type === 'output_text' && part.phase) data['x-phase'] = part.phase
      if (options.includeCitations && part.type === 'output_text' && part.annotations)
        data['x-citations'] = safeCitations
      parts.push({ kind: 'answer', text: part.text, data })
    } else if (options.attachmentMode !== 'omit') {
      const asset = assetCases.find((candidate) => candidate.id === part.attachment_id)!
      parts.push({
        kind: 'attachment',
        attachment: {
          kind: asset.kind,
          name: asset.name,
          path: options.attachmentMode === 'embed' && !asset.missing ? asset.encodedPath : null,
          meta:
            part.type === 'image_result'
              ? { 'x-generation': { generated: true, revised_prompt: generatedPrompt } }
              : {},
        },
      })
    }
  }
  if (options.includeCitations && original.annotations)
    parts.push({ kind: 'x-citations', data: { results: safeCitations } })
  return parts
}

function verifyExport(
  reader: Reader,
  input: ExportSource,
  options: ExportOptions,
  label: string,
): ParsedDocument {
  const exported = buildChatlogMd(input, options)
  const parsed = reader.parseChatlog(exported)
  assert.deepEqual(
    parsed.issues.filter((issue) => issue.level === 'error'),
    [],
    `${label}: 解析错误`,
  )
  assert.equal(parsed.format, 'chatlog-md/2', `${label}: 版本`)
  assert.equal(parsed.meta.title, input.title, `${label}: 标题`)
  assert.equal(parsed.meta.timezone, input.timezone, `${label}: 时区`)
  assert.equal(reader.serializeChatlog(parsed), exported, `${label}: 无操作写回必须逐字一致`)
  const messages = parsed.sessions.flatMap((session) => session.messages)
  assert.deepEqual(
    messages.map((item) => item.id),
    input.messages.map((item) => item.id),
    `${label}: 消息边界与顺序`,
  )
  for (const [index, original] of input.messages.entries()) {
    const actual = messages[index]!
    const context = `${label}/${original.id}`
    assert.equal(
      actual.role,
      original.role === 'assistant' ? 'ai' : original.role,
      `${context}: 角色`,
    )
    assert.equal(actual.model, null, `${context}: 不写旧模型头字段`)
    const expectedModel = {
      ...(options.includeModel ? original.chatlogMetadata?.model : {}),
      ...(options.includeReasoning && original.chatlogMetadata?.reasoning
        ? { reasoningEffort: original.chatlogMetadata.reasoning.effort }
        : {}),
    }
    assert.deepEqual(
      actual.modelInfo,
      Object.keys(expectedModel).length ? expectedModel : undefined,
      `${context}: 模型快照与推理强度`,
    )
    assert.deepEqual(
      actual.usage,
      options.includeUsage ? original.chatlogMetadata?.usage : undefined,
      `${context}: 缺失、零和原始用量`,
    )
    const expected = expectedParts(original, options)
    assert.deepEqual(
      actual.parts.map((part) => part.kind),
      expected.map((part) => part.kind),
      `${context}: 内容块顺序`,
    )
    assert.deepEqual(
      actual.attachments,
      expected.flatMap((part) => (part.attachment ? [part.attachment] : [])),
      `${context}: 附件名称、路径与属性`,
    )
    for (const [partIndex, expectedPart] of expected.entries()) {
      const actualPart = actual.parts[partIndex]!
      if (expectedPart.text !== undefined)
        assert.equal(
          restoredText(actualPart),
          expectedPart.text,
          `${context}/${partIndex}: 原始正文`,
        )
      for (const [key, value] of Object.entries(expectedPart.data ?? {})) {
        assert.deepEqual(actualPart.data?.[key], value, `${context}/${partIndex}: ${key}`)
      }
      if (!options.includeCitations)
        assert.equal(actualPart.data?.['x-citations'], undefined, `${context}: 引用关闭`)
      if (expectedPart.kind === 'x-citations')
        assert.equal(
          actualPart.text?.split('](https://example.test/article)').length,
          2,
          `${context}: 显示去重、结构化引用不去重`,
        )
    }
  }
  return parsed
}

function boundaryTexts(): string[] {
  const texts: string[] = []
  for (const marker of [
    '<!-- @part answer -->',
    '<!-- @endpart -->',
    '<!-- @meta',
    '<!-- @meta key=value -->',
  ]) {
    for (let count = 0; count <= 5; count++) {
      const line = `${'\\'.repeat(count)}${marker}`
      texts.push(line, `\`\`\`md\n${line}\n\`\`\``, `<!-- 普通注释\n${line}\n-->\n结尾`)
    }
  }
  return [
    ...texts,
    '# @2099-01-01\n## 🤖 @ai\n🖼️ [虚构.png](assets/虚构.png)',
    '```inline```\n<!-- @endpart -->',
    '````md\n~~~\n```尾随说明\n<!-- @endpart -->\n`````',
    '   <!-- 普通注释\n<!-- @endpart -->\n<!-- @endpart -->',
    '截断代码\n```ts\nconst value =',
    '\\<!-- @meta\n~~~\n未闭合代码',
    '<!-- 未完成注释\n```ts',
    '正文\r\n```md\r\n<!-- @meta\r\n```',
  ]
}

async function main() {
  const directory = process.argv[2]
  assert.ok(directory, '用法：npx tsx scripts/verify-chatlog-v2.ts <dialogary目录>')
  const reader: Reader = await import(
    pathToFileURL(resolve(directory, 'src/parser/chatlog.ts')).href
  )
  let combinations = 0
  for (let mask = 0; mask < 32; mask++) {
    for (const timePrecision of EXPORT_TIME_PRECISIONS) {
      for (const attachmentMode of EXPORT_ATTACHMENT_MODES) {
        const options = exportOptionsSchema.parse({
          format: 'chatlog-md',
          timezone: fixture.timezone,
          timePrecision,
          attachmentMode,
          includeReasoning: Boolean(mask & 1),
          includeModel: Boolean(mask & 2),
          includeCitations: Boolean(mask & 4),
          includeSearch: Boolean(mask & 8),
          includeUsage: Boolean(mask & 16),
        })
        const label = `开关=${mask},时间=${timePrecision},附件=${attachmentMode}`
        const parsed = verifyExport(reader, fixture, options, label)
        assert.deepEqual(
          parsed.sessions.map((session) => session.date),
          timePrecision === 'none' ? [null] : ['2026-09-20', '2026-09-19', '2026-09-20'],
          `${label}: 日期不重排`,
        )
        const times = [
          '2026-09-20 00:30:24',
          '2026-09-19 00:30:24',
          '2026-09-20 00:30:24',
          '2026-09-20 00:30:24',
        ]
        for (const [index, parsedMessage] of parsed.sessions
          .flatMap((session) => session.messages)
          .entries()) {
          const expectedTime =
            timePrecision === 'none'
              ? null
              : times[index]!.slice(
                  0,
                  timePrecision === 'day' ? 10 : timePrecision === 'minute' ? 16 : 19,
                )
          assert.equal(parsedMessage.time, expectedTime, `${label}: 消息时间`)
          assert.equal(
            parsedMessage.timePrecision,
            timePrecision === 'none' ? null : timePrecision,
            `${label}: 时间精度`,
          )
        }
        combinations++
      }
    }
  }
  const options = exportOptionsSchema.parse({ format: 'chatlog-md', includeUsage: true })
  const texts = boundaryTexts()
  const boundaryMessages = texts.map((text, index) =>
    message(`boundary-${index}`, 'user', [{ type: 'input_text', text }]),
  )
  verifyExport(reader, source(boundaryMessages), options, '字面标记与截断正文')
  const titles = [
    'true',
    '.nan',
    '0123',
    '2026-09-20',
    '多行标题\n---\n保留分隔符',
    '标题\u0000末尾',
  ]
  for (const title of titles)
    verifyExport(
      reader,
      source([fixture.messages[0]!], title),
      options,
      `特殊标题=${JSON.stringify(title)}`,
    )
  process.stdout.write(
    `chatlog-md/2 互操作核验通过：${combinations} 组选项、${texts.length} 个边界正文、${titles.length} 个特殊标题。\n`,
  )
}

await main()
