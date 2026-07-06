import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { clsx } from 'clsx'
import { AlertCircle, Check, Code2 } from 'lucide-react'
import { copyToClipboard } from '../lib/clipboard'
import { useIsDark } from '../lib/useIsDark'
import { toast } from '../store/toast'
import { CopyIcon } from './icons'
import type { MarkdownVariant } from './Markdown'

type MermaidStatus =
  | { state: 'loading' }
  | { state: 'ready'; svg: string }
  | { state: 'error'; message: string }

interface MermaidBlockProps {
  source: string
  variant: MarkdownVariant
  fallback: ReactNode
}

function mermaidId(reactId: string): string {
  const safe = reactId.replace(/[^A-Za-z0-9_-]+/g, '').toLowerCase()
  return `hc-mermaid-${safe || 'diagram'}`
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return '图表语法无法解析'
}

export function MermaidBlock({ source, variant, fallback }: MermaidBlockProps) {
  const reactId = useId()
  const id = useMemo(() => mermaidId(reactId), [reactId])
  const dark = useIsDark()
  const [status, setStatus] = useState<MermaidStatus>({ state: 'loading' })
  const [copied, setCopied] = useState(false)
  const renderSeqRef = useRef(0)

  useEffect(() => {
    const seq = renderSeqRef.current + 1
    renderSeqRef.current = seq
    setStatus({ state: 'loading' })

    async function renderMermaid() {
      try {
        const mermaid = (await import('mermaid')).default
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          suppressErrorRendering: true,
          theme: dark ? 'dark' : 'default',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, Segoe UI, PingFang SC, Microsoft YaHei, sans-serif',
        })
        const { svg } = await mermaid.render(`${id}-${seq}`, source)
        if (renderSeqRef.current === seq) setStatus({ state: 'ready', svg })
      } catch (error) {
        if (renderSeqRef.current === seq)
          setStatus({ state: 'error', message: errorMessage(error) })
      }
    }

    void renderMermaid()
  }, [dark, id, source])

  const copy = () => {
    void copyToClipboard(source).then((ok) => {
      if (!ok) {
        toast.error('复制失败')
        return
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  if (status.state === 'error') {
    return (
      <div className={clsx('hc-mermaid-error', variant === 'reasoning' ? 'my-2' : 'my-4')}>
        <div className="mb-2 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 break-words">Mermaid 渲染失败：{status.message}</span>
        </div>
        {fallback}
      </div>
    )
  }

  return (
    <div
      className={clsx(
        'hc-mermaid-block overflow-hidden rounded-[1.1rem] border border-neutral-200 bg-white text-neutral-950 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50',
        variant === 'reasoning' ? 'my-2' : 'my-4',
      )}
    >
      <div
        className={clsx(
          'flex items-center gap-1.5 border-b border-neutral-100 px-4 text-xs font-medium text-neutral-500 dark:border-neutral-800 dark:text-neutral-300',
          variant === 'reasoning' ? 'py-2' : 'py-2.5',
        )}
      >
        <Code2 className="h-3.5 w-3.5 shrink-0" />
        <span>Mermaid</span>
        <button
          onClick={copy}
          className="ml-auto rounded-md p-1 text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-white"
          aria-label="复制 Mermaid 源码"
          title="复制 Mermaid 源码"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
        </button>
      </div>
      <div className="hc-mermaid-scroll overflow-x-auto">
        {status.state === 'ready' ? (
          <div
            className="hc-mermaid-diagram min-w-fit p-4"
            // Mermaid 官方 API 返回 SVG 字符串；配置保持 strict，图表源码仍来自 Markdown 白名单边界内。
            dangerouslySetInnerHTML={{ __html: status.svg }}
          />
        ) : (
          <div className="flex min-h-32 items-center justify-center px-4 py-8 text-sm text-neutral-400">
            正在渲染图表…
          </div>
        )}
      </div>
    </div>
  )
}
