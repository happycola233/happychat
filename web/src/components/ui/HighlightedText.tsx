import type { ReactNode } from 'react'

/** 按字面值匹配，保留原文大小写；文件名中的括号、加号等字符不会被当作正则。 */
export function HighlightedText({ text, query }: { text: string; query?: string }) {
  const needle = query?.trim()
  if (!needle) return text

  const lowerText = text.toLocaleLowerCase()
  const lowerNeedle = needle.toLocaleLowerCase()
  const parts: ReactNode[] = []
  let cursor = 0

  while (cursor < text.length) {
    const index = lowerText.indexOf(lowerNeedle, cursor)
    if (index === -1) break
    if (index > cursor) parts.push(text.slice(cursor, index))
    const end = index + needle.length
    parts.push(
      <mark
        key={`${index}-${end}`}
        data-testid="search-highlight"
        className="rounded bg-amber-200/80 px-0.5 text-inherit dark:bg-amber-500/30"
      >
        {text.slice(index, end)}
      </mark>,
    )
    cursor = end
  }

  if (parts.length === 0) return text
  if (cursor < text.length) parts.push(text.slice(cursor))
  return <>{parts}</>
}
