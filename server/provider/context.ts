import type { ContentPart, Role } from '@shared/types/domain'

export interface PathMessage {
  role: Role
  content: ContentPart[]
}

export interface ResolvedAttachment {
  dataUrl: string
  mime: string
  filename: string
  kind: 'image' | 'file'
}

/**
 * 由「当前分支路径」的消息构建上游 input[]（本地上下文重放，store=false）。
 * 助手历史用 output_text（annotations 置空）；用户消息用 input_text/input_image/input_file。
 * 图片/文件在请求构建时由 attachments 映射读为内联 base64 data URL。
 */
export function buildInput(
  messages: PathMessage[],
  attachments?: Map<string, ResolvedAttachment>,
): unknown[] {
  const atts = attachments ?? new Map<string, ResolvedAttachment>()
  const items: unknown[] = []

  for (const m of messages) {
    if (m.role === 'assistant') {
      const text = m.content.map((p) => (p.type === 'output_text' ? p.text : '')).join('')
      items.push({
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text, annotations: [] }],
      })
      continue
    }

    const content: unknown[] = []
    for (const part of m.content) {
      if (part.type === 'input_text') {
        content.push({ type: 'input_text', text: part.text })
      } else if (part.type === 'input_image') {
        const a = atts.get(part.attachment_id)
        if (a) content.push({ type: 'input_image', detail: part.detail ?? 'auto', image_url: a.dataUrl })
      } else if (part.type === 'input_file') {
        const a = atts.get(part.attachment_id)
        if (a) content.push({ type: 'input_file', filename: a.filename, file_data: a.dataUrl })
      }
    }
    if (content.length > 0) items.push({ type: 'message', role: m.role, content })
  }
  return items
}
