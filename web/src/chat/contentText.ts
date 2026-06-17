import type { ContentPart } from '@shared/types/domain'

/** 从消息内容部件中提取纯文本（input_text / output_text）。 */
export function textFromContent(content: ContentPart[]): string {
  return content
    .map((p) => (p.type === 'output_text' || p.type === 'input_text' ? p.text : ''))
    .join('')
}
