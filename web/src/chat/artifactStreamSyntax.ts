/**
 * Artifact 生成中代码流的单行分词：给 HTML / SVG / CSS / JS 的标签、属性、字符串等上淡色。
 * 只看当前这一行，不跟踪跨行的 <style> / <script> / 注释状态；流式输出逐字更新时
 * 每次只处理屏幕上的几行，不必对整段源码跑 highlight.js。
 */
export type ArtifactStreamTokenKind =
  | 'plain'
  | 'tag'
  | 'attr'
  | 'string'
  | 'keyword'
  | 'number'
  | 'comment'

export interface ArtifactStreamToken {
  kind: ArtifactStreamTokenKind
  text: string
}

const JS_KEYWORDS = [
  'const',
  'let',
  'var',
  'function',
  'return',
  'if',
  'else',
  'for',
  'while',
  'new',
  'class',
  'async',
  'await',
  'import',
  'export',
  'from',
  'try',
  'catch',
]
const JS_KEYWORD_SET = new Set(JS_KEYWORDS)

const STREAM_TOKEN_PATTERN = new RegExp(
  [
    '<!--[\\s\\S]*?(?:-->|$)',
    '\\/\\*[\\s\\S]*?(?:\\*\\/|$)',
    // 前面是冒号或单词字符的 // 属于网址（https://…），不是行注释。
    '(?<![:\\w])\\/\\/.*$',
    '<\\/?[a-zA-Z][\\w:-]*',
    '\\/>',
    '>',
    '"(?:\\\\.|[^"\\\\])*"',
    "'(?:\\\\.|[^'\\\\])*'",
    '`(?:\\\\.|[^`\\\\])*`',
    `\\b(?:${JS_KEYWORDS.join('|')})\\b`,
    '\\b\\d+(?:\\.\\d+)?(?:px|rem|em|vh|vw|ms|s|deg|%)?\\b',
    '\\b[a-zA-Z_][\\w-]*(?=\\s*[=:])',
  ].join('|'),
  'g',
)

export function tokenizeArtifactStreamLine(line: string): ArtifactStreamToken[] {
  const tokens: ArtifactStreamToken[] = []
  let cursor = 0

  for (const match of line.matchAll(STREAM_TOKEN_PATTERN)) {
    const start = match.index
    const text = match[0]
    if (start > cursor) {
      tokens.push({ kind: 'plain', text: line.slice(cursor, start) })
    }
    tokens.push({ kind: classifyToken(text), text })
    cursor = start + text.length
  }

  if (cursor < line.length) {
    tokens.push({ kind: 'plain', text: line.slice(cursor) })
  }

  return tokens
}

function classifyToken(text: string): ArtifactStreamTokenKind {
  if (text.startsWith('<!--') || text.startsWith('/*') || text.startsWith('//')) return 'comment'
  if (text[0] === '<' || text === '>' || text === '/>') return 'tag'
  if (text[0] === '"' || text[0] === "'" || text[0] === '`') return 'string'
  if (/^\d/.test(text)) return 'number'
  if (JS_KEYWORD_SET.has(text)) return 'keyword'
  return 'attr'
}
