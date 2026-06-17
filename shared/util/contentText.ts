import type { ContentPart } from '../types/domain'

/** Extract searchable/display text from message content parts. */
export function textFromContent(content: ContentPart[]): string {
  return content
    .map((p) => (p.type === 'output_text' || p.type === 'input_text' ? p.text : ''))
    .join('')
}
