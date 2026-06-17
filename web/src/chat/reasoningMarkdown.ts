import { transformOutsideFencedCode } from './markdownSegments'

function normalizeOutsideCode(text: string): string {
  return text.replace(
    /([^\s\r\n])\*\*([A-Z\u4e00-\u9fff][^*\r\n]{2,80}?)\*\*(?=\r?\n|$)/g,
    (_match, before: string, title: string) => `${before}\n\n**${title.trim()}**`,
  )
}

export function normalizeReasoningMarkdown(text: string): string {
  return transformOutsideFencedCode(text, normalizeOutsideCode)
}
