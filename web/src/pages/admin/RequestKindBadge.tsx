import type { UsageLogKind } from '@shared/types/domain'

/** 对话是默认请求类型；只标出容易被误认为用户消息的后台标题总结。 */
export function RequestKindBadge({ kind }: { kind: UsageLogKind }) {
  if (kind !== 'title') return null
  return (
    <span
      title="会话标题总结的后台调用"
      className="rounded bg-neutral-100 px-1.5 py-px text-[10px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
    >
      标题
    </span>
  )
}
