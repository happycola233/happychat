import { z } from 'zod'

/** 支持的导出格式（数组顺序即导出弹窗的卡片展示顺序；chatlog-md 遵循 chatlog-md/1 规范）。 */
export const EXPORT_FORMATS = ['markdown', 'chatlog-md', 'html', 'json', 'jsonl', 'txt'] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]

/** 附件处理方式：打包/内联进导出文件、仅保留文件名、完全不包含。 */
export const EXPORT_ATTACHMENT_MODES = ['embed', 'name', 'omit'] as const
export type ExportAttachmentMode = (typeof EXPORT_ATTACHMENT_MODES)[number]

/** 时间显示精度（对应 chatlog-md 的三种时间戳精度 + 完全不显示）。 */
export const EXPORT_TIME_PRECISIONS = ['second', 'minute', 'day', 'none'] as const
export type ExportTimePrecision = (typeof EXPORT_TIME_PRECISIONS)[number]

export const exportOptionsSchema = z.object({
  format: z.enum(EXPORT_FORMATS),
  /** 消息范围：active=当前可见分支；full=全部分支（仅 JSON 支持完整分支树）。 */
  scope: z.enum(['active', 'full']).default('active'),
  /**
   * 手动选择要导出的消息 id（按当前分支顺序过滤，任意子集）；
   * null / 缺省 = 范围内全部消息。scope=full 时忽略。
   */
  messageIds: z.array(z.string().min(1)).min(1).max(5000).nullable().optional(),
  /** 包含思考摘要（推理模型的 reasoning summary） */
  includeReasoning: z.boolean().default(true),
  /** 在助手消息上标注所用模型名 */
  includeModel: z.boolean().default(true),
  /** 包含联网搜索的引用来源列表 */
  includeCitations: z.boolean().default(true),
  /** 包含联网搜索过程（搜索词 / 打开的页面） */
  includeWebSearch: z.boolean().default(true),
  /** 包含 Token 用量与耗时统计 */
  includeUsage: z.boolean().default(false),
  attachmentMode: z.enum(EXPORT_ATTACHMENT_MODES).default('embed'),
  timePrecision: z.enum(EXPORT_TIME_PRECISIONS).default('second'),
  /** 浏览器 IANA 时区；所有时间戳按此时区格式化，无效值回退服务器时区。 */
  timezone: z.string().min(1).max(64).optional(),
})

export type ExportOptions = z.infer<typeof exportOptionsSchema>

/** 单会话导出请求：preview=true 时返回 JSON 文本预览而非文件流。 */
export const exportConversationRequestSchema = exportOptionsSchema.extend({
  preview: z.boolean().default(false),
})

export type ExportConversationRequest = z.infer<typeof exportConversationRequestSchema>

/** 单次批量导出的会话数上限（前端超限时提前禁用并提示分批，与服务端校验同源）。 */
export const EXPORT_BATCH_MAX = 1000

/** 批量导出请求：多个会话打包为 ZIP（JSONL 格式合并为单文件，每行一个会话）。 */
export const exportBatchRequestSchema = exportOptionsSchema.extend({
  ids: z.array(z.string().min(1)).min(1).max(EXPORT_BATCH_MAX),
})

export type ExportBatchRequest = z.infer<typeof exportBatchRequestSchema>
