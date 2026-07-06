import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import type { Options as SanitizeSchema } from 'rehype-sanitize'
import type { Element, Root } from 'hast'

const SAFE_COLOR_NAMES = new Set([
  'black',
  'blue',
  'brown',
  'cyan',
  'gray',
  'green',
  'grey',
  'magenta',
  'orange',
  'pink',
  'purple',
  'red',
  'transparent',
  'white',
  'yellow',
  'currentcolor',
])

const ALLOWED_TAG_NAMES = [
  'a',
  'blockquote',
  'br',
  'code',
  'del',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'input',
  'kbd',
  'li',
  'mark',
  'ol',
  'p',
  'pre',
  'section',
  'span',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
]

function sanitizeCssColor(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, ' ')
  const lower = normalized.toLowerCase()
  if (SAFE_COLOR_NAMES.has(lower)) return lower === 'currentcolor' ? 'currentColor' : lower
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(normalized)) {
    return normalized
  }

  const rgb = normalized.match(
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0|1|0?\.\d+))?\s*\)$/i,
  )
  if (!rgb) return null

  const channels = rgb.slice(1, 4).map(Number)
  const alpha = rgb[4] === undefined ? 1 : Number(rgb[4])
  if (channels.some((item) => item < 0 || item > 255) || alpha < 0 || alpha > 1) return null
  return normalized
}

function sanitizeCssFontSize(value: string): string | null {
  const normalized = value.trim().toLowerCase()
  const match = normalized.match(/^(\d+(?:\.\d+)?)(px|rem|em|%)$/)
  if (!match) return null

  const size = Number(match[1])
  const unit = match[2]
  if (!Number.isFinite(size)) return null
  if (unit === 'px' && size >= 8 && size <= 32) return normalized
  if ((unit === 'rem' || unit === 'em') && size >= 0.75 && size <= 2) return normalized
  if (unit === '%' && size >= 75 && size <= 200) return normalized
  return null
}

function sanitizeStyle(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined

  const declarations: string[] = []
  for (const rawDeclaration of value.split(';')) {
    const declaration = rawDeclaration.trim()
    if (!declaration) continue

    const separator = declaration.indexOf(':')
    if (separator <= 0) continue

    const property = declaration.slice(0, separator).trim().toLowerCase()
    const rawValue = declaration.slice(separator + 1).trim()
    // Keep this deliberately small: CSS is powerful enough to become a second sanitizer problem.
    if (!rawValue || /!important|url\s*\(|expression\s*\(|var\s*\(|\/\*/i.test(rawValue)) continue

    if (property === 'color') {
      const color = sanitizeCssColor(rawValue)
      if (color) declarations.push(`color: ${color}`)
    } else if (property === 'font-size') {
      const fontSize = sanitizeCssFontSize(rawValue)
      if (fontSize) declarations.push(`font-size: ${fontSize}`)
    }
  }

  return declarations.length ? declarations.join('; ') : undefined
}

function scrubStyleProperties(node: Root | Element): void {
  if (node.type === 'element') {
    if (node.tagName === 'span') {
      const style = sanitizeStyle(node.properties?.style)
      if (style) {
        node.properties = { ...node.properties, style }
      } else if (node.properties) {
        delete node.properties.style
      }
    } else if (node.properties) {
      delete node.properties.style
    }
  }

  if ('children' in node) {
    for (const child of node.children) {
      if (child.type === 'element') scrubStyleProperties(child)
    }
  }
}

export function rehypeSafeInlineStyles() {
  return (tree: Root): void => {
    scrubStyleProperties(tree)
  }
}

export const markdownSanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  // react-markdown/remark-rehype already applies our per-instance clobberPrefix.
  // A second sanitize-layer prefix breaks generated footnote href/id pairs.
  clobber: [],
  tagNames: ALLOWED_TAG_NAMES,
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      ['className', /^language-./, 'math-inline', 'math-display'],
    ],
    span: [...(defaultSchema.attributes?.span ?? []), 'style'],
  },
}

export { rehypeSanitize }
