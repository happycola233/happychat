import { Children, isValidElement, memo, useId, useMemo, useRef, useState } from 'react'
import type { MouseEvent, ReactElement, ReactNode } from 'react'
import { clsx } from 'clsx'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import { Check, Code2, Copy } from 'lucide-react'
import { copyToClipboard } from '../lib/clipboard'
import { toast } from '../store/toast'
import { normalizeMarkdownMath } from './markdownMath'
import { MESSAGE_BODY_TEXT_CLASS } from './messageStyles'
import { resolveNearestTargetScrollTop } from './scrollAnchor'

export type MarkdownVariant = 'message' | 'reasoning'

interface MarkdownProps {
  text: string
  variant?: MarkdownVariant
  className?: string
}

const INTERNAL_HASH_RE = /^#[^\s#]+$/
const FOOTNOTE_BACK_CONTENT = '↩'

function footnoteBackLabel(referenceIndex: number, rereferenceIndex: number): string {
  return `返回正文 ${referenceIndex + 1}${rereferenceIndex > 1 ? `-${rereferenceIndex}` : ''}`
}

function safeDecodeHash(hash: string): string {
  try {
    return decodeURIComponent(hash)
  } catch {
    return hash
  }
}

function isInternalHashLink(href: string | undefined): href is `#${string}` {
  return Boolean(href && INTERNAL_HASH_RE.test(href))
}

function focusHashTarget(target: HTMLElement) {
  const hadTabIndex = target.hasAttribute('tabindex')
  if (!hadTabIndex) target.setAttribute('tabindex', '-1')
  target.focus({ preventScroll: true })
  if (!hadTabIndex) {
    target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true })
  }
}

function cssPixelValue(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function isVerticalScroller(element: HTMLElement): boolean {
  const overflowY = window.getComputedStyle(element).overflowY
  return /(auto|scroll|overlay)/.test(overflowY) && element.scrollHeight > element.clientHeight
}

function findScrollContainer(target: HTMLElement): HTMLElement | null {
  let element = target.parentElement
  while (element) {
    if (isVerticalScroller(element)) return element
    element = element.parentElement
  }

  return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null
}

function scrollElementBounds(scrollElement: HTMLElement): { top: number; bottom: number } {
  if (scrollElement === document.scrollingElement) {
    return { top: 0, bottom: window.innerHeight }
  }

  const rect = scrollElement.getBoundingClientRect()
  return { top: rect.top, bottom: rect.bottom }
}

function scrollTargetIntoNearestView(target: HTMLElement) {
  const scrollElement = findScrollContainer(target)
  if (!scrollElement) {
    target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
    return
  }

  const targetRect = target.getBoundingClientRect()
  const bounds = scrollElementBounds(scrollElement)
  const scrollStyle = window.getComputedStyle(scrollElement)
  const targetStyle = window.getComputedStyle(target)
  const top = resolveNearestTargetScrollTop({
    currentScrollTop: scrollElement.scrollTop,
    scrollHeight: scrollElement.scrollHeight,
    clientHeight: scrollElement.clientHeight,
    containerTop: bounds.top,
    containerBottom: bounds.bottom,
    targetTop: targetRect.top,
    targetBottom: targetRect.bottom,
    insetTop: cssPixelValue(scrollStyle.scrollPaddingTop) + cssPixelValue(targetStyle.scrollMarginTop),
    insetBottom:
      cssPixelValue(scrollStyle.scrollPaddingBottom) + cssPixelValue(targetStyle.scrollMarginBottom),
  })

  scrollElement.scrollTo({ top, behavior: 'smooth' })
}

function scrollToHashTarget(hash: string): boolean {
  const id = safeDecodeHash(hash.slice(1))
  const target = document.getElementById(id)
  if (!target) return false

  window.history.pushState(null, '', `${window.location.pathname}${window.location.search}${hash}`)
  if (target instanceof HTMLElement) {
    scrollTargetIntoNearestView(target)
    focusHashTarget(target)
  }
  return true
}

function markdownInstancePrefix(reactId: string): string {
  const safeId = reactId.replace(/[^A-Za-z0-9]+/g, '').toLowerCase()
  return `user-content-hc-${safeId || 'md'}-`
}

const LANGUAGE_LABELS: Record<string, string> = {
  bash: 'Bash',
  sh: 'Shell',
  shell: 'Shell',
  zsh: 'Zsh',
  ps1: 'PowerShell',
  powershell: 'PowerShell',
  js: 'JavaScript',
  javascript: 'JavaScript',
  jsx: 'JSX',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  tsx: 'TSX',
  py: 'Python',
  python: 'Python',
  json: 'JSON',
  html: 'HTML',
  css: 'CSS',
  sql: 'SQL',
  md: 'Markdown',
  markdown: 'Markdown',
  yml: 'YAML',
  yaml: 'YAML',
}

function languageFrom(children?: ReactNode): string {
  const code = Children.toArray(children).find(
    (child): child is ReactElement<{ className?: string }> => isValidElement(child),
  )
  const className = code?.props.className ?? ''
  const raw = className.match(/(?:^|\s)language-([^\s]+)/)?.[1]?.toLowerCase()
  if (!raw) return 'Text'
  return (
    LANGUAGE_LABELS[raw] ??
    (raw.length <= 4 ? raw.toUpperCase() : raw[0]!.toUpperCase() + raw.slice(1))
  )
}

function PreBlock({ children, variant }: { children?: ReactNode; variant: MarkdownVariant }) {
  const ref = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)
  const language = languageFrom(children)
  const copy = () => {
    const t = ref.current?.textContent ?? ''
    void copyToClipboard(t).then((ok) => {
      if (!ok) {
        toast.error('复制失败')
        return
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <div
      className={clsx(
        'hc-code-block group/code overflow-hidden rounded-[1.35rem] bg-neutral-100 text-neutral-950 dark:bg-neutral-800 dark:text-neutral-50',
        variant === 'reasoning' ? 'my-2' : 'my-4',
      )}
    >
      <div
        className={clsx(
          'flex items-center gap-1.5 px-4 text-xs font-medium',
          variant === 'reasoning' ? 'pt-2.5 pb-1' : 'pt-3 pb-1.5',
        )}
      >
        <Code2 className="h-3.5 w-3.5 shrink-0" />
        <span>{language}</span>
        <button
          onClick={copy}
          className="ml-auto rounded-md p-1 text-neutral-500 transition hover:bg-neutral-200 hover:text-neutral-950 dark:text-neutral-200 dark:hover:bg-neutral-700 dark:hover:text-white"
          aria-label="复制代码"
          title="复制代码"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      <pre
        ref={ref}
        className={clsx(
          'overflow-x-auto px-4 pt-3 font-mono',
          variant === 'reasoning' ? 'pb-4 text-xs leading-5' : 'pb-5 text-[13px] leading-5',
        )}
      >
        {children}
      </pre>
    </div>
  )
}

function tableText(table: HTMLTableElement): string {
  return Array.from(table.rows)
    .map((row) =>
      Array.from(row.cells)
        .map((cell) => (cell.textContent ?? '').replace(/\s+/g, ' ').trim())
        .join('\t'),
    )
    .join('\n')
}

function TableBlock({ children, variant }: { children?: ReactNode; variant: MarkdownVariant }) {
  const ref = useRef<HTMLTableElement>(null)
  const [copied, setCopied] = useState(false)
  const copy = () => {
    const table = ref.current
    if (!table) return
    void copyToClipboard(tableText(table)).then((ok) => {
      if (!ok) {
        toast.error('复制失败')
        return
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div
      className={clsx(
        'hc-table-block group/table relative',
        variant === 'reasoning' ? 'my-2' : 'my-4',
      )}
    >
      <div className="hc-table-scroll overflow-x-auto">
        <table ref={ref}>{children}</table>
      </div>
      <button
        onClick={copy}
        className="absolute right-0 top-1 rounded-lg p-1.5 text-neutral-500 opacity-0 transition group-hover/table:opacity-100 focus-visible:opacity-100 hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-white"
        aria-label="复制表格"
        title="复制表格"
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  )
}

const componentsFor = (variant: MarkdownVariant): Components => ({
  pre: ({ children }) => <PreBlock variant={variant}>{children}</PreBlock>,
  a: ({ href, children, node: _node, className, onClick, ...props }) => {
    const isHashLink = isInternalHashLink(href)
    const isFootnoteBackref = Object.prototype.hasOwnProperty.call(props, 'data-footnote-backref')
    const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
      onClick?.(event)
      if (
        !isHashLink ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.altKey ||
        event.ctrlKey ||
        event.shiftKey
      ) {
        return
      }

      event.preventDefault()
      // 脚注是页内锚点；手动滚动可避免 SPA 内部容器被浏览器当成新页面导航处理。
      if (!scrollToHashTarget(href)) {
        window.history.pushState(
          null,
          '',
          `${window.location.pathname}${window.location.search}${href}`,
        )
      }
    }

    return (
      <a
        {...props}
        href={href}
        onClick={handleClick}
        target={isHashLink ? undefined : '_blank'}
        rel={isHashLink ? undefined : 'noreferrer'}
        className={clsx(
          className,
          isFootnoteBackref
            ? 'text-neutral-400 no-underline transition hover:text-neutral-700 dark:text-neutral-500 dark:hover:text-neutral-200'
            : 'text-blue-600 underline dark:text-blue-400',
        )}
      >
        {children}
      </a>
    )
  },
  table: ({ children }) => <TableBlock variant={variant}>{children}</TableBlock>,
})

function MarkdownImpl({ text, variant = 'message', className }: MarkdownProps) {
  const normalizedText = normalizeMarkdownMath(text)
  const reactId = useId()
  const clobberPrefix = useMemo(() => markdownInstancePrefix(reactId), [reactId])
  return (
    <div
      className={clsx(
        'hc-md break-words',
        variant === 'message'
          ? MESSAGE_BODY_TEXT_CLASS
          : 'hc-md-reasoning text-sm leading-6 text-neutral-500 dark:text-neutral-400',
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
        remarkRehypeOptions={{
          clobberPrefix,
          footnoteLabel: '脚注',
          footnoteBackContent: FOOTNOTE_BACK_CONTENT,
          footnoteBackLabel,
        }}
        rehypePlugins={[[rehypeKatex, { throwOnError: false }], rehypeHighlight]}
        components={componentsFor(variant)}
      >
        {normalizedText}
      </ReactMarkdown>
    </div>
  )
}

// 流式时频繁更新，memo 避免无谓重渲染（仅 text 变化时重渲）
export const Markdown = memo(MarkdownImpl)
