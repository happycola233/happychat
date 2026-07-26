import type {
  ExportAttachmentMode,
  ExportFormat,
  ExportOptions,
} from '../schemas/export'

/**
 * 每种导出格式支持的选项能力矩阵。
 *
 * 前端据此禁用不适用的控件（并展示原因），服务端据此在构建前归一化选项——
 * 两端共用同一份事实，保证「界面上不可选」与「服务端不生效」永远一致。
 */
export interface ExportFormatCaps {
  /** 用户可见名称 */
  label: string
  /** 文件扩展名（不含点） */
  ext: string
  /** 主文件 MIME（下载响应用） */
  mime: string
  /** 选择卡片上的一句话说明 */
  description: string
  /** 该格式遵循的开放规范链接（弹窗内提供跳转）；无则不展示 */
  specUrl?: string
  /** 支持思考摘要 */
  reasoning: boolean
  /** 支持模型名标注 */
  model: boolean
  /** 支持引用来源列表 */
  citations: boolean
  /** 支持联网搜索过程 */
  webSearch: boolean
  /** 支持 Token 用量统计 */
  usage: boolean
  /** 时间精度选项是否生效（JSON/JSONL 保留原始毫秒时间戳，不适用） */
  time: boolean
  /** 支持导出全部分支（树形结构） */
  scopeFull: boolean
  /** 支持的附件模式（首项为该格式的回退默认值） */
  attachmentModes: readonly ExportAttachmentMode[]
  /** embed 模式的载体：zip=ZIP+assets/ 目录；inline=内联 data URI 单文件 */
  embedVia: 'zip' | 'inline' | null
}

export const EXPORT_FORMAT_CAPS: Record<ExportFormat, ExportFormatCaps> = {
  markdown: {
    label: 'Markdown 文档',
    ext: 'md',
    mime: 'text/markdown; charset=utf-8',
    description: '阅读友好的通用 Markdown，任意编辑器 / GitHub 均可直接查看',
    reasoning: true,
    model: true,
    citations: true,
    webSearch: true,
    usage: true,
    time: true,
    scopeFull: false,
    attachmentModes: ['embed', 'name', 'omit'],
    embedVia: 'zip',
  },
  'chatlog-md': {
    label: 'chatlog-md 日记',
    ext: 'chat.md',
    mime: 'text/markdown; charset=utf-8',
    description: '遵循 chatlog-md/1 规范的纯 Markdown 对话日记，适合长期保存与程序解析',
    specUrl:
      'https://github.com/happycola233/dialogary/blob/main/chatlog-md-%E6%A0%BC%E5%BC%8F%E8%A7%84%E8%8C%83.md',
    reasoning: true,
    model: true,
    citations: true,
    webSearch: false,
    usage: true,
    time: true,
    scopeFull: false,
    attachmentModes: ['embed', 'name', 'omit'],
    embedVia: 'zip',
  },
  html: {
    label: '网页（HTML）',
    ext: 'html',
    mime: 'text/html; charset=utf-8',
    description: '自包含单文件网页，附件内联嵌入，浅色 / 深色主题自动适配',
    reasoning: true,
    model: true,
    citations: true,
    webSearch: true,
    usage: true,
    time: true,
    scopeFull: false,
    attachmentModes: ['embed', 'name', 'omit'],
    embedVia: 'inline',
  },
  json: {
    label: 'JSON 数据',
    ext: 'json',
    mime: 'application/json; charset=utf-8',
    description: '全量结构化数据（含分支树与元信息），适合备份与二次处理',
    reasoning: true,
    model: true,
    citations: true,
    webSearch: true,
    usage: true,
    time: false,
    scopeFull: true,
    attachmentModes: ['embed', 'name', 'omit'],
    embedVia: 'zip',
  },
  jsonl: {
    label: 'JSONL（messages）',
    ext: 'jsonl',
    mime: 'application/jsonl; charset=utf-8',
    description: 'OpenAI messages 格式，每行一个会话，适合程序处理与微调数据集',
    reasoning: false,
    model: false,
    citations: false,
    webSearch: false,
    usage: false,
    time: false,
    scopeFull: false,
    attachmentModes: ['name', 'omit'],
    embedVia: null,
  },
  txt: {
    label: '纯文本',
    ext: 'txt',
    mime: 'text/plain; charset=utf-8',
    description: '最通用的纯文本记录，任何设备可读',
    reasoning: true,
    model: true,
    citations: true,
    webSearch: true,
    usage: true,
    time: true,
    scopeFull: false,
    attachmentModes: ['embed', 'name', 'omit'],
    embedVia: 'zip',
  },
}

/**
 * 按格式能力归一化选项：不支持的开关强制关闭、不支持的取值回退。
 * 服务端构建器只消费归一化后的选项，无需各自判断格式差异。
 */
export function normalizeExportOptions(options: ExportOptions): ExportOptions {
  const caps = EXPORT_FORMAT_CAPS[options.format]
  const scope = options.scope === 'full' && caps.scopeFull ? 'full' : 'active'
  return {
    ...options,
    scope,
    // 全部分支导出的是整棵树，逐条选择无意义
    messageIds: scope === 'full' ? null : (options.messageIds ?? null),
    includeReasoning: caps.reasoning && options.includeReasoning,
    includeModel: caps.model && options.includeModel,
    includeCitations: caps.citations && options.includeCitations,
    includeWebSearch: caps.webSearch && options.includeWebSearch,
    includeUsage: caps.usage && options.includeUsage,
    attachmentMode: caps.attachmentModes.includes(options.attachmentMode)
      ? options.attachmentMode
      : caps.attachmentModes[0]!,
  }
}
