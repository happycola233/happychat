import { transformOutsideFencedCode, transformOutsideInlineCode } from './markdownSegments'

function displayMathReplacement(prefix: string, body: string): string {
  const trimmed = body.trim()
  const leadingBreak = prefix && !/\n[ \t]*$/.test(prefix) ? '\n\n' : ''
  return `${prefix}${leadingBreak}$$\n${trimmed}\n$$\n\n`
}

function normalizeStandaloneDisplayMathDelimiters(text: string): string {
  // Markdown containers such as blockquotes need to keep their line prefix on
  // the delimiter lines; otherwise `>` is swallowed into the KaTeX source.
  return text.replace(/^([ \t]*(?:>[ \t]*)*)\\(?:\[|\])[ \t]*$/gm, (_match, prefix: string) => {
    return `${prefix}$$`
  })
}

function normalizeLatexDelimiters(text: string): string {
  return normalizeStandaloneDisplayMathDelimiters(text)
    .replace(/(^|[^\\])\\\[([\s\S]*?)\\\]/g, (_match, prefix: string, body: string) =>
      displayMathReplacement(prefix, body),
    )
    .replace(/(^|[^\\])\\\(([\s\S]*?)\\\)/g, (_match, prefix: string, body: string) => {
      const trimmed = body.trim()
      return `${prefix}$$${trimmed}$$`
    })
}

export function normalizeMarkdownMath(text: string): string {
  return transformOutsideFencedCode(text, (segment) =>
    transformOutsideInlineCode(segment, normalizeLatexDelimiters),
  )
}
