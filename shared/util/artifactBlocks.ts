/**
 * 回答正文里的 Artifact 代码块：```artifact 是协议约定的 HTML 片段，```svg 是模型常直接给出的矢量图，
 * 两者都在站内沙箱 iframe 中渲染。其他场景（摘要、通知、搜索片段、标题总结）只需要知道「这里有一个什么 Artifact」。
 */

/** 系统提示词约定的代码块语言标记。 */
export const ARTIFACT_BLOCK_LANGUAGE = 'artifact'

const ARTIFACT_LANGUAGES: ReadonlySet<string> = new Set([ARTIFACT_BLOCK_LANGUAGE, 'svg'])

/** 该语言的代码块渲染成 Artifact 卡片，而不是代码。 */
export function isArtifactLanguage(language: string | null | undefined): boolean {
  return language !== null && language !== undefined && ARTIFACT_LANGUAGES.has(language)
}

const TITLE_PATTERN = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i
const TITLE_MAX_CHARACTERS = 60
const BASIC_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

function decodeBasicEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
    if (body[0] === '#') {
      const codePoint =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10)
      return Number.isInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : entity
    }
    return BASIC_ENTITIES[body.toLowerCase()] ?? entity
  })
}

/** 取源码中第一个 <title>（HTML 片段的标题或 SVG 的标题元素）作为卡片标题；没有时返回 null。 */
export function artifactTitle(source: string): string | null {
  const raw = TITLE_PATTERN.exec(source)?.[1]
  if (!raw) return null
  const text = decodeBasicEntities(raw.replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return null
  const characters = Array.from(text)
  return characters.length > TITLE_MAX_CHARACTERS
    ? `${characters.slice(0, TITLE_MAX_CHARACTERS - 1).join('')}…`
    : text
}

/** 纯文本场景里代替整段代码的简短说明，与时间轴预览的「[图片：…]」保持同一写法。 */
export function artifactLabel(title: string | null): string {
  return title ? `[Artifact：${title}]` : '[Artifact]'
}

interface CodeFence {
  char: string
  size: number
  language: string
}

function openingFence(line: string): CodeFence | null {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.replace(/\r$/, ''))
  if (!match) return null
  const marker = match[1]!
  const info = match[2]!.trim()
  // CommonMark：反引号围栏的信息串里不能再出现反引号。
  if (marker[0] === '`' && info.includes('`')) return null
  return {
    char: marker[0]!,
    size: marker.length,
    language: info.split(/\s+/)[0]!.toLowerCase(),
  }
}

function closesFence(line: string, fence: CodeFence): boolean {
  const match = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line.replace(/\r$/, ''))
  return Boolean(match && match[1]![0] === fence.char && match[1]!.length >= fence.size)
}

/**
 * 把顶层的 Artifact 代码块整体替换成 `replace(源码)` 的结果，其余内容（含其他代码块）逐行保留。
 * 未闭合的 Artifact 代码块（流式中途）同样替换，避免半截源码出现在摘要里。
 */
export function replaceArtifactBlocks(
  markdown: string,
  replace: (source: string) => string,
): string {
  const output: string[] = []
  let fence: (CodeFence & { body: string[]; artifact: boolean }) | null = null
  for (const line of markdown.split('\n')) {
    if (!fence) {
      const opened = openingFence(line)
      if (opened) fence = { ...opened, body: [], artifact: isArtifactLanguage(opened.language) }
      if (!fence?.artifact) output.push(line)
      continue
    }
    if (closesFence(line, fence)) {
      output.push(fence.artifact ? replace(fence.body.join('\n')) : line)
      fence = null
    } else if (fence.artifact) {
      fence.body.push(line)
    } else {
      output.push(line)
    }
  }
  if (fence?.artifact) output.push(replace(fence.body.join('\n')))
  return output.join('\n')
}

/** 摘要、通知、搜索与标题总结使用的可读文本：Artifact 代码块只保留「[Artifact：标题]」。 */
export function summarizeArtifactBlocks(markdown: string): string {
  return replaceArtifactBlocks(markdown, (source) => artifactLabel(artifactTitle(source)))
}

/** 流式分块中的单个顶层块是否是已经闭合的 Artifact 代码块：闭合后即可提前渲染。 */
export function isClosedArtifactFence(block: string): boolean {
  const lines = block
    .replace(/^\s*\n/, '')
    .replace(/\s+$/, '')
    .split('\n')
  const opened = openingFence(lines[0] ?? '')
  return (
    opened !== null &&
    isArtifactLanguage(opened.language) &&
    lines.length >= 2 &&
    closesFence(lines[lines.length - 1]!, opened)
  )
}
