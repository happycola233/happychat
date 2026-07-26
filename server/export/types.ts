import type { ConversationDTO, MessageDTO } from '@shared/types/api'

/** 一条附件在导出时的完整上下文（DB 元数据 + 可选的磁盘内容）。 */
export interface ExportAttachment {
  id: string
  kind: 'image' | 'file'
  mime: string
  filename: string
  byteSize: number
  /** embed 模式下在 ZIP 内的相对路径（assets/xxx）；其他模式为 null */
  assetPath: string | null
  /** 文件内容；仅 embed 且非预览时读盘，其余为 null */
  data: Uint8Array | null
  /** DB 行缺失或磁盘文件读取失败（构建器按「仅文件名」降级展示） */
  missing: boolean
}

/** 归一化后的导出数据源：所有构建器共用同一份输入。 */
export interface ExportSource {
  conversation: ConversationDTO
  /** 会话标题（空标题已回退为默认值） */
  title: string
  /** 参与导出的消息：active=根→叶路径顺序；full=按创建时间升序的整棵树 */
  messages: MessageDTO[]
  /**
   * scope=full 时的有效当前叶子：会话的 activeLeafId 若指向被剔除的
   * 流式占位消息，已回退到最近的存活祖先；scope=active 时为 null
   */
  activeLeafId: string | null
  /** content 中引用到的附件（含 DB 行缺失的占位项） */
  attachments: Map<string, ExportAttachment>
  /** 导出时刻（epoch ms），由调用方统一注入保证各构建器一致 */
  exportedAt: number
  /** 已解析的有效 IANA 时区 */
  timezone: string
}

/** 单个导出产物（可能是文本文件或 ZIP）。 */
export interface BuiltExport {
  filename: string
  mime: string
  data: Uint8Array
  /** ZIP 内条目（供预览展示）；单文件时为 null */
  zipEntries: { name: string; size: number }[] | null
}
