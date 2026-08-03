import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { unzipSync, strFromU8 } from 'fflate'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ContentPart, MessageStatus, UrlCitation, SearchAction } from '@shared/types/domain'
import { exportOptionsSchema, type ExportOptions } from '@shared/schemas/export'
// archive 不依赖数据库环境，可静态导入直接单测
import { buildZip, ZIP_MAX_ENTRIES } from './archive'

let tmpDir: string
let dbClient: typeof import('../db/client')
let schema: typeof import('../db/schema')
let exporter: typeof import('./index')
let seq = 0

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'happychat-export-'))
  process.env.NODE_ENV = 'test'
  process.env.DATA_DIR = tmpDir
  process.env.DATABASE_URL = join(tmpDir, 'happychat-test.db')
  process.env.SESSION_SECRET = 'test-session-secret-export'

  vi.resetModules()
  const migration = await import('../db/migrate')
  dbClient = await import('../db/client')
  schema = await import('../db/schema')
  exporter = await import('./index')
  migration.runMigrations()
})

afterAll(() => {
  dbClient?.sqlite.close()
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
})

// ---------- fixtures ----------

async function createUser() {
  const n = seq++
  const [user] = await dbClient.db
    .insert(schema.users)
    .values({ username: `export-user-${n}`, passwordHash: 'hash' })
    .returning()
  if (!user) throw new Error('Failed to create user')
  return user
}

async function createModel() {
  const n = seq++
  const [provider] = await dbClient.db
    .insert(schema.providers)
    .values({ name: `export-provider-${n}`, baseUrl: 'https://example.test/v1', apiKey: 'k' })
    .returning()
  if (!provider) throw new Error('Failed to create provider')
  const [model] = await dbClient.db
    .insert(schema.models)
    .values({
      providerId: provider.id,
      modelId: `export-model-${n}`,
      displayName: '测试模型',
      capabilities: {
        vision: true,
        file_input: true,
        web_search: true,
        x_search: false,
        image_generation: false,
        reasoning: true,
      },
      allowedEfforts: [{ value: 'high', description: '深度思考' }],
      defaultEffort: 'high',
      defaultWebSearch: false,
      defaultXSearch: false,
    })
    .returning()
  if (!model) throw new Error('Failed to create model')
  return model
}

async function addMessage(input: {
  conversationId: string
  parentId?: string | null
  role: 'user' | 'assistant'
  content: ContentPart[]
  status?: MessageStatus
  modelId?: string | null
  createdAt: Date
  reasoningSummary?: string | null
  reasoningDurationMs?: number | null
  generationDurationMs?: number | null
  annotations?: UrlCitation[] | null
  searchActions?: SearchAction[] | null
  tokens?: { input: number; output: number; reasoning?: number; cached?: number; total: number }
  errorMessage?: string | null
}) {
  const [message] = await dbClient.db
    .insert(schema.messages)
    .values({
      conversationId: input.conversationId,
      parentId: input.parentId ?? null,
      role: input.role,
      status: input.status ?? 'complete',
      content: input.content,
      modelId: input.modelId ?? null,
      createdAt: input.createdAt,
      reasoningSummary: input.reasoningSummary ?? null,
      reasoningDurationMs: input.reasoningDurationMs ?? null,
      generationDurationMs: input.generationDurationMs ?? null,
      annotations: input.annotations ?? null,
      searchActions: input.searchActions ?? null,
      inputTokens: input.tokens?.input ?? null,
      outputTokens: input.tokens?.output ?? null,
      reasoningTokens: input.tokens?.reasoning ?? null,
      cachedTokens: input.tokens?.cached ?? null,
      totalTokens: input.tokens?.total ?? null,
      errorMessage: input.errorMessage ?? null,
    })
    .returning()
  if (!message) throw new Error('Failed to create message')
  return message
}

async function addAttachment(input: {
  userId: string
  kind: 'image' | 'file'
  mime: string
  filename: string
  bytes: Uint8Array | null
  byteSize?: number
}) {
  const id = `att-${seq++}`
  const dir = join(tmpDir, 'uploads', input.userId)
  mkdirSync(dir, { recursive: true })
  const storagePath = join(dir, `${id}.bin`)
  if (input.bytes) writeFileSync(storagePath, input.bytes)
  const [row] = await dbClient.db
    .insert(schema.attachments)
    .values({
      id,
      userId: input.userId,
      kind: input.kind,
      mime: input.mime,
      filename: input.filename,
      byteSize: input.byteSize ?? input.bytes?.length ?? 123,
      storagePath,
    })
    .returning()
  if (!row) throw new Error('Failed to create attachment')
  return row
}

/**
 * 标准导出测试树（Asia/Shanghai 时区）：
 *
 *   u1(23:04:06 周五, 带图片附件) ── a1(思考摘要+模型) ── u2(次日, 正文含哨兵撞车行)
 *     ── a2(引用+搜索+用量, 带缺失附件) ← activeLeaf
 *   a1 ── u2b（并列分支）
 */
async function createExportTree() {
  const user = await createUser()
  const model = await createModel()
  const [conv] = await dbClient.db
    .insert(schema.conversations)
    .values({ userId: user.id, title: '导出测试对话' })
    .returning()
  if (!conv) throw new Error('Failed to create conversation')

  const img = await addAttachment({
    userId: user.id,
    kind: 'image',
    mime: 'image/png',
    filename: '照片.png',
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
  })
  const lost = await addAttachment({
    userId: user.id,
    kind: 'image',
    mime: 'image/png',
    filename: '走丢的图.png',
    bytes: null,
  })

  const t1 = new Date('2025-03-28T15:04:06Z') // 上海 2025-03-28 23:04:06 周五
  const t2 = new Date('2025-03-28T15:04:19Z')
  const t3 = new Date('2025-03-29T01:00:00Z') // 上海 2025-03-29 09:00:00 周六
  const t4 = new Date('2025-03-29T01:00:30Z')

  const u1 = await addMessage({
    conversationId: conv.id,
    role: 'user',
    createdAt: t1,
    content: [
      { type: 'input_text', text: '你好，看图！' },
      { type: 'input_image', attachment_id: img.id },
    ],
  })
  const a1 = await addMessage({
    conversationId: conv.id,
    parentId: u1.id,
    role: 'assistant',
    modelId: model.id,
    createdAt: t2,
    reasoningSummary: '**理解图片**\n用户发来了一张图片……',
    reasoningDurationMs: 84_000,
    content: [{ type: 'output_text', text: '收到！这是一张测试图片。' }],
  })
  const u2 = await addMessage({
    conversationId: conv.id,
    parentId: a1.id,
    role: 'user',
    createdAt: t3,
    content: [
      {
        type: 'input_text',
        text: '正文哨兵撞车测试：\n## @ai\n## @user 假装消息头\n🖼️ 假附件行\n# @2025-01-01\n# @2025-01-01 发布日志\n\\🖼️ 反斜杠行\n普通行不受影响',
      },
    ],
  })
  const a2 = await addMessage({
    conversationId: conv.id,
    parentId: u2.id,
    role: 'assistant',
    modelId: model.id,
    createdAt: t4,
    generationDurationMs: 3210,
    annotations: [
      {
        type: 'url_citation',
        url: 'https://example.com/a',
        title: '示例来源',
        start_index: 0,
        end_index: 4,
      },
      {
        type: 'url_citation',
        url: 'https://example.com/a',
        title: '重复来源',
        start_index: 5,
        end_index: 8,
      },
    ],
    searchActions: [
      { type: 'search', queries: ['天气'] },
      { type: 'open_page', url: 'https://example.com/weather' },
      { type: 'x_keyword_search', queries: ['from:xai 天气'], handles: ['xai'], mode: 'Latest' },
      { type: 'x_thread_fetch', postId: '2081485024872796427' },
    ],
    tokens: { input: 100, output: 50, reasoning: 10, cached: 20, total: 150 },
    content: [
      { type: 'output_text', text: '好的，答案在这里。' },
      { type: 'image_result', attachment_id: lost.id, revised_prompt: '一张丢失的图' },
    ],
  })
  const u2b = await addMessage({
    conversationId: conv.id,
    parentId: a1.id,
    role: 'user',
    createdAt: new Date('2025-03-29T02:00:00Z'),
    content: [{ type: 'input_text', text: '并列分支的问题' }],
  })

  await dbClient.db
    .update(schema.conversations)
    .set({ activeLeafId: a2.id })
    .where(eq(schema.conversations.id, conv.id))

  return { user, model, conv, img, lost, u1, a1, u2, a2, u2b }
}

async function createConversation(userId: string, title: string | null = '导出测试对话') {
  const [conv] = await dbClient.db
    .insert(schema.conversations)
    .values({ userId, title })
    .returning()
  if (!conv) throw new Error('Failed to create conversation')
  return conv
}

async function setActiveLeaf(conversationId: string, leafId: string) {
  await dbClient.db
    .update(schema.conversations)
    .set({ activeLeafId: leafId })
    .where(eq(schema.conversations.id, conversationId))
}

function opts(partial: Partial<ExportOptions> & Pick<ExportOptions, 'format'>): ExportOptions {
  return exportOptionsSchema.parse({ timezone: 'Asia/Shanghai', ...partial })
}

/** ZIP 里按后缀取唯一文本条目。 */
function zipText(data: Uint8Array, suffix: string): string {
  const entries = unzipSync(data)
  const name = Object.keys(entries).find((k) => k.endsWith(suffix))
  if (!name) throw new Error(`zip 中找不到 ${suffix}，实际条目：${Object.keys(entries).join(', ')}`)
  return strFromU8(entries[name]!)
}

// ---------- tests ----------

describe('chatlog-md 导出', () => {
  it('生成符合规范的 front matter、日期节、消息头、思考块、附件行与转义', async () => {
    const { user, conv } = await createExportTree()
    const result = await exporter.exportConversation(
      user.id,
      conv.id,
      opts({ format: 'chatlog-md' }),
    )
    if (!result.ok) throw new Error('导出失败')

    // 有附件 → ZIP 打包；主文件 + assets/，缺失附件不入包
    expect(result.file.filename.endsWith('.zip')).toBe(true)
    const entries = unzipSync(result.file.data)
    const names = Object.keys(entries)
    expect(names.some((n) => n.endsWith('.chat.md'))).toBe(true)
    expect(names).toContain('assets/照片.png')
    expect(names.some((n) => n.includes('走丢的图'))).toBe(false)

    const text = zipText(result.file.data, '.chat.md')
    // front matter
    expect(text.startsWith('---\nformat: chatlog-md/1\n')).toBe(true)
    expect(text).toContain('title: 导出测试对话')
    expect(text).toContain('timezone: Asia/Shanghai')
    expect(text).toContain('exported_by: HappyChat')
    // 日期节（按上海时区分日 + 中文星期）
    expect(text).toContain('# @2025-03-28 · 周五')
    expect(text).toContain('# @2025-03-29 · 周六')
    // 消息头：时间戳到秒；AI 带模型名
    expect(text).toContain('## 🧑‍💻 @user · 2025-03-28 23:04:06')
    expect(text).toContain('## 🤖 @ai · 2025-03-28 23:04:19 · 测试模型')
    // 思考块：标记行 + 引用体
    expect(text).toContain('> 🤔 已思考 1m 24s')
    expect(text).toContain('> **理解图片**')
    // 附件：链接形（已嵌入）与纯名形（文件缺失）
    expect(text).toContain('🖼️ [照片.png](assets/照片.png)')
    expect(text).toContain('🖼️ 走丢的图.png')
    expect(text).toContain('<!-- @meta generated=true prompt=一张丢失的图 -->')
    // 正文哨兵转义（规范 §10）：严格匹配消息头正则的行才转义
    expect(text).toContain('\\## @ai')
    expect(text).toContain('\\🖼️ 假附件行')
    expect(text).toContain('\\# @2025-01-01')
    // 「@user 后跟非 · 分隔文本」不是合法消息头，不是哨兵 → 原样保留保证往返保真
    expect(text).not.toContain('\\## @user 假装消息头')
    expect(text).toContain('\n## @user 假装消息头')
    // 日期后跟非 · 分隔文本同理（§5 正则要求 · 分隔标题）
    expect(text).not.toContain('\\# @2025-01-01 发布日志')
    expect(text).toContain('\n# @2025-01-01 发布日志')
    // 本就以 \ 开头且剥掉 \ 后命中哨兵的行要再补一个 \，与解析侧剥一层构成无损往返
    expect(text).toContain('\\\\🖼️ 反斜杠行')
    expect(text).toContain('普通行不受影响')
    // 引用来源按 URL 去重
    expect(text).toContain('**来源**')
    expect(text).toContain('1. [示例来源](https://example.com/a)')
    expect(text).not.toContain('重复来源')
    // 默认不含用量 meta
    expect(text).not.toContain('input_tokens=')
  })

  it('仅文件名模式输出单文件；关闭时间后无日期节与时间戳', async () => {
    const { user, conv } = await createExportTree()
    const named = await exporter.exportConversation(
      user.id,
      conv.id,
      opts({ format: 'chatlog-md', attachmentMode: 'name' }),
    )
    if (!named.ok) throw new Error('导出失败')
    expect(named.file.filename.endsWith('.chat.md')).toBe(true)
    const namedText = new TextDecoder().decode(named.file.data)
    expect(namedText).toContain('🖼️ 照片.png')
    expect(namedText).not.toContain('](assets/')

    const noTime = await exporter.exportConversation(
      user.id,
      conv.id,
      opts({ format: 'chatlog-md', attachmentMode: 'omit', timePrecision: 'none' }),
    )
    if (!noTime.ok) throw new Error('导出失败')
    const noTimeText = new TextDecoder().decode(noTime.file.data)
    // 严格形状的日期节哨兵不应存在（正文里被转义的 \# @… 与带尾巴的非哨兵行不算）
    expect(noTimeText).not.toMatch(/^# @\d{4}-\d{2}-\d{2}\s*(?:·.*)?$/m)
    expect(noTimeText).toContain('## 🧑‍💻 @user\n')
    // omit 只移除附件行哨兵；正文里被转义的 \🖼️ 文本不受影响
    expect(noTimeText).not.toMatch(/^🖼️ /m)
    expect(noTimeText).not.toContain('照片.png')
  })

  it('开启用量统计后写入 @meta；日期精度只保留日期', async () => {
    const { user, conv } = await createExportTree()
    const result = await exporter.exportConversation(
      user.id,
      conv.id,
      opts({
        format: 'chatlog-md',
        includeUsage: true,
        timePrecision: 'day',
        attachmentMode: 'omit',
      }),
    )
    if (!result.ok) throw new Error('导出失败')
    const text = new TextDecoder().decode(result.file.data)
    expect(text).toContain('## 🧑‍💻 @user · 2025-03-28')
    expect(text).toMatch(/<!-- @meta [^>]*input_tokens=100/)
    expect(text).toMatch(/total_tokens=150/)
    expect(text).toMatch(/cached_tokens=20/)
    expect(text).toMatch(/generation_ms=3210/)
  })

  it('手动选择消息只导出选中子集；选中集不在路径上时报 empty_selection', async () => {
    const { user, conv, u1, a1 } = await createExportTree()
    const result = await exporter.exportConversation(
      user.id,
      conv.id,
      opts({ format: 'chatlog-md', attachmentMode: 'omit', messageIds: [u1.id, a1.id] }),
    )
    if (!result.ok) throw new Error('导出失败')
    const text = new TextDecoder().decode(result.file.data)
    expect(text).toContain('你好，看图！')
    expect(text).not.toContain('答案在这里')

    const empty = await exporter.exportConversation(
      user.id,
      conv.id,
      opts({ format: 'chatlog-md', messageIds: ['不存在的消息'] }),
    )
    expect(empty.ok).toBe(false)
    if (!empty.ok) expect(empty.code).toBe('empty_selection')
  })
})

describe('其他格式', () => {
  it('markdown：角色标题、内嵌图片、检索过程（网页 + X）与来源', async () => {
    const { user, conv } = await createExportTree()
    const result = await exporter.exportConversation(user.id, conv.id, opts({ format: 'markdown' }))
    if (!result.ok) throw new Error('导出失败')
    const text = zipText(result.file.data, '.md')
    expect(text).toContain('# 导出测试对话')
    expect(text).toContain('## 🧑‍💻 用户 · 2025-03-28 23:04:06')
    expect(text).toContain('## 🤖 助手 · 2025-03-28 23:04:19 · 测试模型')
    expect(text).toContain('![照片.png](assets/照片.png)')
    expect(text).toContain('**检索过程**')
    expect(text).toContain('- 搜索：「天气」')
    expect(text).toContain('- 打开页面：https://example.com/weather')
    expect(text).toContain('- X 检索：「from:xai 天气」（仅 @xai，按最新排序）')
    expect(text).toContain('- 读取 X 讨论串：https://x.com/i/status/2081485024872796427')
    expect(text).toContain('[示例来源](https://example.com/a)')
  })

  it('txt：时间戳前缀与模型名标注', async () => {
    const { user, conv } = await createExportTree()
    const result = await exporter.exportConversation(
      user.id,
      conv.id,
      opts({ format: 'txt', attachmentMode: 'name' }),
    )
    if (!result.ok) throw new Error('导出失败')
    const text = new TextDecoder().decode(result.file.data)
    expect(text).toContain('[2025-03-28 23:04:06] 用户')
    expect(text).toContain('助手（测试模型）')
    expect(text).toContain('〔图片〕照片.png')
    expect(text).toContain('〔来源 1〕示例来源 — https://example.com/a')
  })

  it('json：全部分支包含整棵树与 activeLeafId，选项过滤字段', async () => {
    const { user, conv, u2b, a2 } = await createExportTree()
    const result = await exporter.exportConversation(
      user.id,
      conv.id,
      opts({ format: 'json', scope: 'full', includeReasoning: false, attachmentMode: 'name' }),
    )
    if (!result.ok) throw new Error('导出失败')
    const doc = JSON.parse(new TextDecoder().decode(result.file.data)) as {
      format: string
      conversation: { activeLeafId: string | null }
      messages: Record<string, unknown>[]
    }
    expect(doc.format).toBe('happychat-export/1')
    expect(doc.messages).toHaveLength(5)
    expect(doc.conversation.activeLeafId).toBe(a2.id)
    expect(doc.messages.some((m) => m.id === u2b.id)).toBe(true)
    const assistant = doc.messages.find((m) => m.id === a2.id)!
    expect(assistant.reasoningSummary).toBeUndefined()
    expect(assistant.searchActions).toEqual([
      { type: 'search', queries: ['天气'] },
      { type: 'open_page', url: 'https://example.com/weather' },
      { type: 'x_keyword_search', queries: ['from:xai 天气'], handles: ['xai'], mode: 'Latest' },
      { type: 'x_thread_fetch', postId: '2081485024872796427' },
    ])
    expect(assistant.attachments).toEqual([expect.objectContaining({ filename: '走丢的图.png' })])
  })

  it('jsonl：单行 messages 结构，附件按文件名占位', async () => {
    const { user, conv } = await createExportTree()
    const result = await exporter.exportConversation(user.id, conv.id, opts({ format: 'jsonl' }))
    if (!result.ok) throw new Error('导出失败')
    const text = new TextDecoder().decode(result.file.data).trim()
    expect(text.split('\n')).toHaveLength(1)
    const doc = JSON.parse(text) as { messages: { role: string; content: string }[] }
    expect(doc.messages[0]).toEqual({
      role: 'user',
      content: '[图片：照片.png]\n你好，看图！',
    })
    expect(doc.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
  })

  it('html：自包含单文件，附件内联 data URI，危险 HTML 被清洗', async () => {
    const user = await createUser()
    const [conv] = await dbClient.db
      .insert(schema.conversations)
      .values({ userId: user.id, title: 'HTML<导出>' })
      .returning()
    if (!conv) throw new Error('Failed to create conversation')
    const img = await addAttachment({
      userId: user.id,
      kind: 'image',
      mime: 'image/png',
      filename: 'inline.png',
      bytes: new Uint8Array([1, 2, 3]),
    })
    const u1 = await addMessage({
      conversationId: conv.id,
      role: 'user',
      createdAt: new Date('2025-03-28T15:00:00Z'),
      content: [
        { type: 'input_text', text: '看图 <script>alert(1)</script> **加粗**' },
        { type: 'input_image', attachment_id: img.id },
      ],
    })
    await dbClient.db
      .update(schema.conversations)
      .set({ activeLeafId: u1.id })
      .where(eq(schema.conversations.id, conv.id))

    const result = await exporter.exportConversation(user.id, conv.id, opts({ format: 'html' }))
    if (!result.ok) throw new Error('导出失败')
    // HTML 附件内联，不打包 ZIP
    expect(result.file.filename.endsWith('.html')).toBe(true)
    const text = new TextDecoder().decode(result.file.data)
    expect(text).toContain('<title>HTML&lt;导出&gt;</title>')
    expect(text).toContain('data:image/png;base64,AQID')
    expect(text).toContain('<strong>加粗</strong>')
    expect(text).not.toContain('<script>alert(1)</script>')
    expect(text).toContain('prefers-color-scheme:dark')
  })
})

describe('预览 / 批量 / 边界', () => {
  it('预览不读磁盘但返回一致的产物结构与截断文本', async () => {
    const { user, conv } = await createExportTree()
    const result = await exporter.previewConversationExport(
      user.id,
      conv.id,
      opts({ format: 'chatlog-md' }),
    )
    if (!result.ok) throw new Error('预览失败')
    expect(result.preview.kind).toBe('zip')
    expect(result.preview.filename.endsWith('.zip')).toBe(true)
    expect(result.preview.entries?.some((e) => e.name === 'assets/照片.png')).toBe(true)
    // 磁盘缺失的附件在预览里同样按纯名形展示
    expect(result.preview.preview).toContain('🖼️ 走丢的图.png')
    expect(result.preview.preview).toContain('🖼️ [照片.png](assets/照片.png)')
    expect(result.preview.truncated).toBe(false)
    expect(result.preview.messageCount).toBe(4)
  })

  it('批量导出打包每个会话独立文件夹；jsonl 合并为多行单文件', async () => {
    const t1 = await createExportTree()
    const t2 = await createExportTree()
    // 同属一个用户才能一起导出
    await dbClient.db
      .update(schema.conversations)
      .set({ userId: t1.user.id })
      .where(eq(schema.conversations.id, t2.conv.id))

    const zip = await exporter.exportConversationsBatch(
      t1.user.id,
      [t1.conv.id, t2.conv.id, '不存在'],
      opts({ format: 'markdown', attachmentMode: 'omit' }),
    )
    if (!zip.ok) throw new Error('批量导出失败')
    const names = Object.keys(unzipSync(zip.file.data))
    expect(names.some((n) => n.startsWith('01 导出测试对话/'))).toBe(true)
    expect(names.some((n) => n.startsWith('02 导出测试对话/'))).toBe(true)

    const jsonl = await exporter.exportConversationsBatch(
      t1.user.id,
      [t1.conv.id, t2.conv.id],
      opts({ format: 'jsonl' }),
    )
    if (!jsonl.ok) throw new Error('批量导出失败')
    expect(new TextDecoder().decode(jsonl.file.data).trim().split('\n')).toHaveLength(2)
    // 不存在的会话被跳过，实际导出数如实返回
    expect(zip.exportedCount).toBe(2)
    expect(jsonl.exportedCount).toBe(2)
  })

  it('embed 附件总量超过预算上限时拒绝导出，预览与真实导出同判', async () => {
    const user = await createUser()
    const [conv] = await dbClient.db
      .insert(schema.conversations)
      .values({ userId: user.id, title: '超大附件' })
      .returning()
    if (!conv) throw new Error('Failed to create conversation')
    const huge = await addAttachment({
      userId: user.id,
      kind: 'file',
      mime: 'application/octet-stream',
      filename: '大文件.bin',
      bytes: null,
      byteSize: 600 * 1024 * 1024,
    })
    const u1 = await addMessage({
      conversationId: conv.id,
      role: 'user',
      createdAt: new Date('2025-03-28T15:00:00Z'),
      content: [
        { type: 'input_text', text: '发个大文件' },
        { type: 'input_file', attachment_id: huge.id, filename: '大文件.bin' },
      ],
    })
    await dbClient.db
      .update(schema.conversations)
      .set({ activeLeafId: u1.id })
      .where(eq(schema.conversations.id, conv.id))

    const denied = await exporter.exportConversation(user.id, conv.id, opts({ format: 'markdown' }))
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.code).toBe('attachments_too_large')

    const previewDenied = await exporter.previewConversationExport(
      user.id,
      conv.id,
      opts({ format: 'markdown' }),
    )
    expect(previewDenied.ok).toBe(false)

    // 改用「仅保留文件名」即可正常导出
    const named = await exporter.exportConversation(
      user.id,
      conv.id,
      opts({ format: 'markdown', attachmentMode: 'name' }),
    )
    expect(named.ok).toBe(true)
  })

  it('归属校验：他人会话报 not_found；流式空占位消息被剔除', async () => {
    const { conv } = await createExportTree()
    const outsider = await createUser()
    const denied = await exporter.exportConversation(outsider.id, conv.id, opts({ format: 'txt' }))
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.code).toBe('not_found')

    // 流式空占位（生成中被导出）不应出现在结果里
    const user = await createUser()
    const [c2] = await dbClient.db
      .insert(schema.conversations)
      .values({ userId: user.id, title: null })
      .returning()
    if (!c2) throw new Error('Failed to create conversation')
    const q = await addMessage({
      conversationId: c2.id,
      role: 'user',
      createdAt: new Date('2025-03-28T15:00:00Z'),
      content: [{ type: 'input_text', text: '问题' }],
    })
    const placeholder = await addMessage({
      conversationId: c2.id,
      parentId: q.id,
      role: 'assistant',
      status: 'streaming',
      createdAt: new Date('2025-03-28T15:00:01Z'),
      content: [],
    })
    await dbClient.db
      .update(schema.conversations)
      .set({ activeLeafId: placeholder.id })
      .where(eq(schema.conversations.id, c2.id))

    const result = await exporter.exportConversation(user.id, c2.id, opts({ format: 'txt' }))
    if (!result.ok) throw new Error('导出失败')
    expect(result.file.filename.startsWith('未命名聊天 ')).toBe(true)
    const text = new TextDecoder().decode(result.file.data)
    expect(text).toContain('问题')
    expect(text).not.toContain('助手')
  })
})

describe('审查修复回归', () => {
  it('正文保留首行缩进与行尾空格，仅去掉首尾空白行', async () => {
    const user = await createUser()
    const conv = await createConversation(user.id)
    const m = await addMessage({
      conversationId: conv.id,
      role: 'user',
      createdAt: new Date('2025-03-28T15:00:00Z'),
      content: [{ type: 'input_text', text: '\n\n    indented()\n硬换行  \n结尾\n\n' }],
    })
    await setActiveLeaf(conv.id, m.id)

    const result = await exporter.exportConversation(
      user.id,
      conv.id,
      opts({ format: 'markdown', timePrecision: 'none' }),
    )
    if (!result.ok) throw new Error('导出失败')
    const text = new TextDecoder().decode(result.file.data)
    // 首行 4 空格缩进（Markdown 缩进代码块）与行尾双空格（硬换行）不被破坏
    expect(text).toContain('\n    indented()\n')
    expect(text).toContain('硬换行  \n')
    // 首尾空白行被去掉：标题块后紧跟正文，无多余空行
    expect(text).toContain('## 🧑‍💻 用户\n\n    indented()')
  })

  it('附件名含空格/#/括号时链接目标百分号编码，中文保持原样', async () => {
    const user = await createUser()
    const conv = await createConversation(user.id)
    const att = await addAttachment({
      userId: user.id,
      kind: 'image',
      mime: 'image/png',
      filename: 'my photo #1 (副本).png',
      bytes: new Uint8Array([1, 2, 3]),
    })
    const m = await addMessage({
      conversationId: conv.id,
      role: 'user',
      createdAt: new Date('2025-03-28T15:00:00Z'),
      content: [
        { type: 'input_text', text: '看图' },
        { type: 'input_image', attachment_id: att.id },
      ],
    })
    await setActiveLeaf(conv.id, m.id)

    const result = await exporter.exportConversation(
      user.id,
      conv.id,
      opts({ format: 'chatlog-md' }),
    )
    if (!result.ok) throw new Error('导出失败')
    const text = zipText(result.file.data, '.chat.md')
    expect(text).toContain('🖼️ [my photo #1 (副本).png](assets/my%20photo%20%231%20%28副本%29.png)')
    // ZIP 内的真实路径不编码
    expect(Object.keys(unzipSync(result.file.data))).toContain('assets/my photo #1 (副本).png')
  })

  it('citation URL 里的换行与括号被编码，无法伪造 chatlog 行首哨兵', async () => {
    const user = await createUser()
    const model = await createModel()
    const conv = await createConversation(user.id)
    const q = await addMessage({
      conversationId: conv.id,
      role: 'user',
      createdAt: new Date('2025-03-28T15:00:00Z'),
      content: [{ type: 'input_text', text: '问题' }],
    })
    const a = await addMessage({
      conversationId: conv.id,
      parentId: q.id,
      role: 'assistant',
      modelId: model.id,
      createdAt: new Date('2025-03-28T15:00:05Z'),
      annotations: [
        {
          type: 'url_citation',
          url: 'https://evil.test/a)\n## @ai',
          title: '恶意来源',
          start_index: 0,
          end_index: 1,
        },
      ],
      content: [{ type: 'output_text', text: '回答' }],
    })
    await setActiveLeaf(conv.id, a.id)

    const result = await exporter.exportConversation(
      user.id,
      conv.id,
      opts({ format: 'chatlog-md', includeModel: false, timePrecision: 'none' }),
    )
    if (!result.ok) throw new Error('导出失败')
    const text = new TextDecoder().decode(result.file.data)
    // URL 解析会移除换行，Markdown 清洗继续编码括号；裸 `## @ai` 行不存在
    expect(text).toContain('https://evil.test/a%29##%20@ai')
    expect(text).not.toMatch(/^## @ai\s*$/m)
    expect(text).not.toMatch(/^\)\s*$/m)
  })

  it.each(['markdown', 'chatlog-md', 'html'] as const)(
    '%s 导出不会生成非 http(s) citation 链接',
    async (format) => {
      const user = await createUser()
      const model = await createModel()
      const conv = await createConversation(user.id)
      const q = await addMessage({
        conversationId: conv.id,
        role: 'user',
        createdAt: new Date('2025-03-28T15:00:00Z'),
        content: [{ type: 'input_text', text: '问题' }],
      })
      const a = await addMessage({
        conversationId: conv.id,
        parentId: q.id,
        role: 'assistant',
        modelId: model.id,
        createdAt: new Date('2025-03-28T15:00:05Z'),
        annotations: [
          {
            type: 'url_citation',
            url: 'javascript:alert(document.domain)',
            title: '不安全来源',
            start_index: 0,
            end_index: 1,
          },
        ],
        content: [{ type: 'output_text', text: '回答' }],
      })
      await setActiveLeaf(conv.id, a.id)

      const result = await exporter.exportConversation(
        user.id,
        conv.id,
        opts({ format, includeModel: false, timePrecision: 'none' }),
      )
      if (!result.ok) throw new Error('导出失败')
      const text = new TextDecoder().decode(result.file.data)
      expect(text).not.toContain('javascript:')
      expect(text).not.toContain('不安全来源')
    },
  )

  it('YAML 歧义标题（true/数字）在 front matter 中加引号保持字符串类型', async () => {
    const user = await createUser()
    for (const [title, expected] of [
      ['true', 'title: "true"'],
      ['123', 'title: "123"'],
    ] as const) {
      const conv = await createConversation(user.id, title)
      const m = await addMessage({
        conversationId: conv.id,
        role: 'user',
        createdAt: new Date('2025-03-28T15:00:00Z'),
        content: [{ type: 'input_text', text: '内容' }],
      })
      await setActiveLeaf(conv.id, m.id)
      const result = await exporter.exportConversation(
        user.id,
        conv.id,
        opts({ format: 'chatlog-md' }),
      )
      if (!result.ok) throw new Error('导出失败')
      expect(new TextDecoder().decode(result.file.data)).toContain(expected)
    }
  })

  it('scope=full 时 activeLeafId 悬空则回退到最近存活祖先', async () => {
    const user = await createUser()
    const conv = await createConversation(user.id)
    const q = await addMessage({
      conversationId: conv.id,
      role: 'user',
      createdAt: new Date('2025-03-28T15:00:00Z'),
      content: [{ type: 'input_text', text: '问题' }],
    })
    const placeholder = await addMessage({
      conversationId: conv.id,
      parentId: q.id,
      role: 'assistant',
      status: 'streaming',
      createdAt: new Date('2025-03-28T15:00:01Z'),
      content: [],
    })
    await setActiveLeaf(conv.id, placeholder.id)

    const result = await exporter.exportConversation(
      user.id,
      conv.id,
      opts({ format: 'json', scope: 'full' }),
    )
    if (!result.ok) throw new Error('导出失败')
    const doc = JSON.parse(new TextDecoder().decode(result.file.data)) as {
      conversation: { activeLeafId: string | null }
      messages: { id: string }[]
    }
    // 空流式占位被剔除后，activeLeafId 指向其父消息而非悬空 id
    expect(doc.messages.map((m) => m.id)).toEqual([q.id])
    expect(doc.conversation.activeLeafId).toBe(q.id)
  })

  it('DB 行缺失的图片引用保留 kind=image 与提示文件名', async () => {
    const user = await createUser()
    const conv = await createConversation(user.id)
    const m = await addMessage({
      conversationId: conv.id,
      role: 'user',
      createdAt: new Date('2025-03-28T15:00:00Z'),
      content: [
        { type: 'input_text', text: '图呢' },
        { type: 'input_image', attachment_id: 'missing-att-row' },
      ],
    })
    await setActiveLeaf(conv.id, m.id)

    const result = await exporter.exportConversation(
      user.id,
      conv.id,
      opts({ format: 'json', attachmentMode: 'name' }),
    )
    if (!result.ok) throw new Error('导出失败')
    const doc = JSON.parse(new TextDecoder().decode(result.file.data)) as {
      messages: { attachments?: { kind: string; missing?: boolean }[] }[]
    }
    expect(doc.messages[0]!.attachments).toEqual([
      expect.objectContaining({ kind: 'image', missing: true }),
    ])
  })

  it('jsonl：无有效样本的会话不产行——单会话报 empty_selection，批量计入跳过', async () => {
    const user = await createUser()
    // 只有一条纯附件消息的会话（omit 模式下没有任何文本样本）
    const attOnly = await createConversation(user.id, '纯附件')
    const att = await addAttachment({
      userId: user.id,
      kind: 'image',
      mime: 'image/png',
      filename: 'only.png',
      bytes: new Uint8Array([1]),
    })
    const m1 = await addMessage({
      conversationId: attOnly.id,
      role: 'user',
      createdAt: new Date('2025-03-28T15:00:00Z'),
      content: [{ type: 'input_image', attachment_id: att.id }],
    })
    await setActiveLeaf(attOnly.id, m1.id)

    const single = await exporter.exportConversation(
      user.id,
      attOnly.id,
      opts({ format: 'jsonl', attachmentMode: 'omit' }),
    )
    expect(single.ok).toBe(false)
    if (!single.ok) expect(single.code).toBe('empty_selection')

    // 正常会话 + 纯附件会话批量导出：只产 1 行，exportedCount 如实为 1
    const normal = await createConversation(user.id, '正常会话')
    const m2 = await addMessage({
      conversationId: normal.id,
      role: 'user',
      createdAt: new Date('2025-03-28T15:00:00Z'),
      content: [{ type: 'input_text', text: '有文本' }],
    })
    await setActiveLeaf(normal.id, m2.id)
    const batch = await exporter.exportConversationsBatch(
      user.id,
      [attOnly.id, normal.id],
      opts({ format: 'jsonl', attachmentMode: 'omit' }),
    )
    if (!batch.ok) throw new Error('批量导出失败')
    expect(batch.exportedCount).toBe(1)
    expect(new TextDecoder().decode(batch.file.data).trim().split('\n')).toHaveLength(1)
  })

  it('流式 ZIP：混合存储/同步/异步压缩条目可正确解包还原', async () => {
    const big = new Uint8Array(200_000)
    for (let i = 0; i < big.length; i++) big[i] = i % 251
    const entries = [
      { path: 'a.png', data: new Uint8Array([1, 2, 3]) },
      { path: 'small.txt', data: new TextEncoder().encode('hello 小文件') },
      { path: 'big.txt', data: big },
    ]
    const zipData = await buildZip(entries)
    const out = unzipSync(zipData)
    expect(Object.keys(out).sort()).toEqual(['a.png', 'big.txt', 'small.txt'])
    expect(out['a.png']).toEqual(new Uint8Array([1, 2, 3]))
    expect(out['big.txt']).toEqual(big)
    expect(strFromU8(out['small.txt']!)).toBe('hello 小文件')
  })

  it('ZIP 条目数超过 65535 上限时明确拒绝而非产出损坏文件', async () => {
    const entries = Array.from({ length: ZIP_MAX_ENTRIES + 1 }, (_, i) => ({
      path: `f${i}.txt`,
      data: new Uint8Array(0),
    }))
    await expect(buildZip(entries)).rejects.toThrow(/65535/)
  })
})
