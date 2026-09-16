import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { copyToClipboard } from '../../lib/clipboard'
import { toast } from '../../store/toast'
import { Button } from './Button'

export function CopyButton({
  value,
  label = '复制',
  className,
}: {
  value: string
  label?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="ghost"
      size="sm"
      className={className}
      onClick={async () => {
        const ok = await copyToClipboard(value)
        if (ok) {
          setCopied(true)
          toast.success('已复制')
        } else toast.error('复制失败，请重试')
      }}
      onBlur={() => setCopied(false)}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-500" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      {copied ? '已复制' : label}
    </Button>
  )
}
