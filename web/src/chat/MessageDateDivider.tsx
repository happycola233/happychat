import { useLocalDate } from '../hooks/useLocalDate'
import { formatMessageDay, isSameLocalDay } from './messageTime'

export function MessageDateDivider({
  timestamp,
  previousTimestamp,
}: {
  timestamp: number
  previousTimestamp?: number
}) {
  const { today, timeZone } = useLocalDate()
  if (previousTimestamp !== undefined && isSameLocalDay(timestamp, previousTimestamp)) return null
  return (
    <div className="mb-6 flex items-center gap-3" data-testid="message-date-divider">
      <span aria-hidden="true" className="h-px flex-1 bg-neutral-200/70 dark:bg-neutral-800" />
      <time
        dateTime={new Date(timestamp).toISOString()}
        className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400"
      >
        {formatMessageDay(timestamp, today, timeZone)}
      </time>
      <span aria-hidden="true" className="h-px flex-1 bg-neutral-200/70 dark:bg-neutral-800" />
    </div>
  )
}
