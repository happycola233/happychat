import { transformOutsideFencedCode, transformOutsideInlineCode } from './markdownSegments'

function normalizeOutsideCode(text: string): string {
  // 新版 Responses API 可能把每个 summary part 分别返回为 `**Title**`，旧数据层曾
  // 直接拼成 `**A****B****C**`。先恢复相邻标题的 Markdown 段落边界，再兼容原有
  // “正文末尾粘住单个标题”的形态。规则只命中大写英文/中文标题，并要求后一个
  // 粗体片段在行尾结束，避免拆开普通的行内强调。
  const separatedHeadingChain = text.replace(
    /\*\*(?=\*\*[A-Z\u4e00-\u9fff][^*\r\n]{2,80}?\*\*(?=\*\*|\r?\n|$))/g,
    '**\n\n',
  )

  return separatedHeadingChain.replace(
    /([^\s\r\n])\*\*([A-Z\u4e00-\u9fff][^*\r\n]{2,80}?)\*\*(?=\r?\n|$)/g,
    (_match, before: string, title: string) => `${before}\n\n**${title.trim()}**`,
  )
}

export function normalizeReasoningMarkdown(text: string): string {
  return transformOutsideFencedCode(text, (segment) =>
    transformOutsideInlineCode(segment, normalizeOutsideCode),
  )
}
