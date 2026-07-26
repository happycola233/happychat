import type { ExportOptions } from '@shared/schemas/export'
import { attachmentDisplayName, attachmentRefsOf, textOfContent } from './content'
import type { ExportSource } from './types'

/**
 * OpenAI messages 格式（JSONL）：一个会话压成一行
 * `{"messages":[{"role":"user","content":"…"},…]}`，适合程序处理与微调数据集。
 *
 * 只保留文本内容；附件按选项以「[图片：名称]」占位或完全省略；
 * 没有任何文本的消息（如纯图片生成回复）会被跳过。所有消息都被跳过时
 * 返回 null——空 messages 的行不是有效样本，调用方按「无内容」处理。
 */
export function buildJsonlLine(source: ExportSource, options: ExportOptions): string | null {
  const messages: { role: string; content: string }[] = []
  for (const m of source.messages) {
    const segments: string[] = []
    if (options.attachmentMode === 'name') {
      for (const ref of attachmentRefsOf(m.content)) {
        const attachment = ref.attachmentId ? source.attachments.get(ref.attachmentId) : undefined
        const label = ref.kind === 'image' ? '图片' : '文件'
        segments.push(`[${label}：${attachmentDisplayName(ref, attachment)}]`)
      }
    }
    const text = textOfContent(m.content)
    if (text) segments.push(text)
    if (segments.length === 0) continue
    messages.push({ role: m.role, content: segments.join('\n') })
  }
  if (messages.length === 0) return null
  return JSON.stringify({ title: source.conversation.title, messages })
}
