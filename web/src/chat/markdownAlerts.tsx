import { Children, cloneElement, isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { Element, RootContent } from 'hast'
import type { LucideIcon } from 'lucide-react'
import { Info, Lightbulb, MessageSquareWarning, OctagonAlert, TriangleAlert } from 'lucide-react'

export type MarkdownAlertType = 'note' | 'tip' | 'important' | 'warning' | 'caution'

interface MarkdownAlertMeta {
  label: string
  Icon: LucideIcon
}

export interface MarkdownAlertMatch {
  type: MarkdownAlertType
  stripPrefix: string
}

const ALERT_MARKER_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/i
const EMPTY_NODE = Symbol('empty-node')

const ALERT_META: Record<MarkdownAlertType, MarkdownAlertMeta> = {
  note: { label: 'Note', Icon: Info },
  tip: { label: 'Tip', Icon: Lightbulb },
  important: { label: 'Important', Icon: MessageSquareWarning },
  warning: { label: 'Warning', Icon: TriangleAlert },
  caution: { label: 'Caution', Icon: OctagonAlert },
}

function textFromHast(node: RootContent): string {
  if (node.type === 'text') return node.value
  if ('children' in node) return node.children.map((child) => textFromHast(child)).join('')
  return ''
}

function firstMeaningfulChild(node: Element): RootContent | undefined {
  return node.children.find((child) => child.type !== 'text' || child.value.trim() !== '')
}

function alertTypeFromLine(line: string): MarkdownAlertType | null {
  const match = line.trim().match(ALERT_MARKER_RE)
  return match ? (match[1]!.toLowerCase() as MarkdownAlertType) : null
}

export function matchMarkdownAlert(node: Element | undefined): MarkdownAlertMatch | null {
  if (!node || node.tagName !== 'blockquote') return null

  const firstChild = firstMeaningfulChild(node)
  if (!firstChild || firstChild.type !== 'element' || firstChild.tagName !== 'p') return null

  const firstParagraphText = textFromHast(firstChild)
  const lineBreak = firstParagraphText.match(/\r?\n/)
  const firstLineEnd = lineBreak?.index ?? firstParagraphText.length
  const firstLine = firstParagraphText.slice(0, firstLineEnd)
  const type = alertTypeFromLine(firstLine)
  if (!type) return null

  const stripEnd = lineBreak ? firstLineEnd + lineBreak[0].length : firstParagraphText.length
  return { type, stripPrefix: firstParagraphText.slice(0, stripEnd) }
}

interface StripState {
  remaining: string
}

function isEmptyReactNode(node: ReactNode): boolean {
  if (node === null || node === undefined || typeof node === 'boolean') return true
  if (typeof node === 'string') return node.length === 0
  if (Array.isArray(node)) return node.every(isEmptyReactNode)
  return false
}

function stripTextPrefix(value: string, state: StripState): ReactNode | typeof EMPTY_NODE {
  if (!state.remaining) return value

  if (value.startsWith(state.remaining)) {
    const nextValue = value.slice(state.remaining.length)
    state.remaining = ''
    return nextValue || EMPTY_NODE
  }

  if (state.remaining.startsWith(value)) {
    state.remaining = state.remaining.slice(value.length)
    return EMPTY_NODE
  }

  return value
}

function stripReactPrefix(node: ReactNode, state: StripState): ReactNode | typeof EMPTY_NODE {
  if (!state.remaining) return node
  if (node === null || node === undefined || typeof node === 'boolean') return node

  if (typeof node === 'string' || typeof node === 'number') {
    return stripTextPrefix(String(node), state)
  }

  if (Array.isArray(node)) {
    const nextChildren: ReactNode[] = []
    for (const child of node) {
      const nextChild = stripReactPrefix(child, state)
      if (nextChild !== EMPTY_NODE) nextChildren.push(nextChild)
    }
    return nextChildren.length ? nextChildren : EMPTY_NODE
  }

  if (!isValidElement<{ children?: ReactNode }>(node)) return node

  const nextChildren = stripReactPrefix(node.props.children, state)
  if (nextChildren === EMPTY_NODE || isEmptyReactNode(nextChildren)) return EMPTY_NODE

  return cloneElement(node as ReactElement<{ children?: ReactNode }>, undefined, nextChildren)
}

export function stripMarkdownAlertMarker(children: ReactNode, stripPrefix: string): ReactNode {
  const state: StripState = { remaining: stripPrefix }
  const strippedChildren: ReactNode[] = []

  for (const child of Children.toArray(children)) {
    const nextChild = stripReactPrefix(child, state)
    if (nextChild !== EMPTY_NODE) strippedChildren.push(nextChild)
  }

  return state.remaining ? children : strippedChildren
}

export function getMarkdownAlertMeta(type: MarkdownAlertType): MarkdownAlertMeta {
  return ALERT_META[type]
}
