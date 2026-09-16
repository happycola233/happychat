import { useState } from 'react'
import type { ModelDTO } from '@shared/types/api'
import { useMe } from '../hooks/useAuth'
import { UsageNoticeMessage } from './UsageNoticeMessage'

function remembered(key: string, signature: string): boolean {
  try {
    return localStorage.getItem(key) === signature
  } catch {
    return false
  }
}

export function ModelUsageNotice({ model }: { model: ModelDTO }) {
  const { data: user } = useMe()
  const notice = model.usageNotice
  const signature = JSON.stringify(notice)
  const key = `happychat-model-notice:${user?.id ?? ''}:${model.id}`
  const [dismissed, setDismissed] = useState<string | null>(null)
  if (!notice?.enabled || !notice.body || !user) return null
  const canDismiss = notice.dismissible || notice.frequency === 'once'
  if (
    canDismiss &&
    (dismissed === signature || (notice.frequency === 'once' && remembered(key, signature)))
  )
    return null

  return (
    <div className="pointer-events-auto pb-2 hc-anim-in">
      <UsageNoticeMessage
        notice={notice}
        modelName={model.displayName}
        onDismiss={
          canDismiss
            ? () => {
                setDismissed(signature)
                if (notice.frequency === 'once') {
                  try {
                    localStorage.setItem(key, signature)
                  } catch {
                    /* 存储不可用时仍允许在当前页面确认。 */
                  }
                }
              }
            : undefined
        }
      />
    </div>
  )
}
