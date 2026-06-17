import { memo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import { Check, Copy } from 'lucide-react'

function PreBlock({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)
  const copy = () => {
    const t = ref.current?.textContent ?? ''
    void navigator.clipboard.writeText(t).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <div className="group/code relative my-3 overflow-hidden rounded-xl bg-neutral-900">
      <button
        onClick={copy}
        className="absolute top-2 right-2 z-10 rounded-md bg-neutral-800 p-1.5 text-neutral-400 opacity-0 transition group-hover/code:opacity-100 hover:text-white"
        aria-label="复制代码"
        title="复制代码"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      <pre ref={ref} className="overflow-x-auto p-4 text-sm leading-6">
        {children}
      </pre>
    </div>
  )
}

const components: Components = {
  pre: ({ children }) => <PreBlock>{children}</PreBlock>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-blue-600 underline dark:text-blue-400">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table>{children}</table>
    </div>
  ),
}

function MarkdownImpl({ text }: { text: string }) {
  return (
    <div className="hc-md text-[15px] leading-7 break-words text-neutral-800 dark:text-neutral-100">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeHighlight, rehypeKatex]}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

// 流式时频繁更新，memo 避免无谓重渲染（仅 text 变化时重渲）
export const Markdown = memo(MarkdownImpl)
