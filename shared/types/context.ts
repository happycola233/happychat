/** 历史附件的保留方式；按轮会完整保留同一次发送或生成的附件。 */
export type AttachmentRetention =
  | { mode: 'all' }
  | { mode: 'none' }
  | { mode: 'rounds' | 'items'; limit: number }

export interface ContextPolicy {
  /** 保留的历史对话轮数，不含本次提问；null 表示全部，0 表示仅本次。 */
  historyTurns: number | null
  uploads: AttachmentRetention
  generatedImages: AttachmentRetention
}

/** 只影响一次请求的人工选择，优先于自动保留规则；本次新附件始终受保护。 */
export interface ContextAttachmentSelection {
  include: string[]
  exclude: string[]
}
