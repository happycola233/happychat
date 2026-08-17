import { clsx } from 'clsx'
import { Copy, Infinity as InfinityIcon, Pencil, Star, Trash2 } from 'lucide-react'
import type { AdminQuotaPolicyDTO } from '@shared/types/api'
import type { QuotaRule } from '@shared/types/domain'
import { IconButton } from '../../components/ui/IconButton'
import { cardSurface } from '../../components/ui/Card'
import { draftFromRule, summarizeQuotaRuleDraft } from './quotaRuleDrafts'

function PolicyRuleRow({ rule }: { rule: QuotaRule }) {
  const summary = summarizeQuotaRuleDraft(draftFromRule(rule))
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-2.5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-sm text-neutral-800 dark:text-neutral-100">
            {summary.title}
          </span>
          {summary.priority != null && (
            <span className="shrink-0 rounded-md bg-sky-50 px-1.5 py-px text-[10px] font-medium text-sky-600 dark:bg-sky-500/10 dark:text-sky-300">
              优先 {summary.priority}
            </span>
          )}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-neutral-400 dark:text-neutral-500">
          {summary.subtitle}
        </div>
      </div>
      <div
        className={clsx(
          'shrink-0 pt-0.5 text-right text-xs tabular-nums',
          summary.unlimited
            ? 'font-medium text-violet-600 dark:text-violet-300'
            : 'font-medium text-neutral-700 dark:text-neutral-200',
        )}
      >
        {summary.limitText}
        {summary.windowText ? (
          <span className="font-normal text-neutral-400 dark:text-neutral-500">
            {' '}
            · {summary.windowText}
          </span>
        ) : null}
      </div>
    </div>
  )
}

/**
 * 策略列表卡片：规则用与编辑器折叠行同一套摘要，避免把整句 describeQuotaRule
 * 塞进换行 chip 里——「未知分组各自独立 · $4.00」那种长标签扫起来很累。
 */
export function QuotaPolicyCard({
  policy,
  onEdit,
  onDuplicate,
  onDelete,
  onSetDefault,
}: {
  policy: AdminQuotaPolicyDTO
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
  onSetDefault: () => void
}) {
  return (
    <div
      className={clsx(
        cardSurface,
        'cursor-pointer overflow-hidden transition hover:border-neutral-300 dark:hover:border-neutral-600',
        policy.isDefault && 'ring-1 ring-sky-200/80 dark:ring-sky-800/70',
      )}
      onClick={onEdit}
    >
      <div className="flex items-start justify-between gap-3 px-4 py-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
              {policy.name}
            </h3>
            {policy.isDefault && (
              <span className="shrink-0 rounded-md bg-sky-50 px-1.5 py-px text-[10px] font-medium text-sky-600 dark:bg-sky-500/10 dark:text-sky-300">
                默认
              </span>
            )}
          </div>
          {policy.description && (
            <p className="mt-0.5 truncate text-xs text-neutral-400 dark:text-neutral-500">
              {policy.description}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center" onClick={(event) => event.stopPropagation()}>
          {!policy.isDefault && (
            <IconButton label="设为默认策略" onClick={onSetDefault}>
              <Star className="h-4 w-4" />
            </IconButton>
          )}
          <IconButton label="复制策略" onClick={onDuplicate}>
            <Copy className="h-4 w-4" />
          </IconButton>
          <IconButton label="编辑策略" onClick={onEdit}>
            <Pencil className="h-4 w-4" />
          </IconButton>
          <IconButton label="删除策略" tone="danger" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </IconButton>
        </div>
      </div>

      <div className="border-t border-neutral-100 dark:border-neutral-800">
        {policy.rules.length === 0 ? (
          <div className="flex items-start gap-2.5 px-4 py-5 text-sm text-neutral-500 dark:text-neutral-400">
            <InfinityIcon className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" />
            <div>
              <div className="font-medium text-neutral-700 dark:text-neutral-200">无限额度</div>
              <p className="mt-0.5 text-[11px] leading-5 text-neutral-400 dark:text-neutral-500">
                没有任何规则，绑定该策略的用户不受用量限制。
              </p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {policy.rules.map((rule) => (
              <PolicyRuleRow key={rule.id} rule={rule} />
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-neutral-100 px-4 py-2.5 text-[11px] text-neutral-400 dark:border-neutral-800 dark:text-neutral-500">
        {policy.boundUserCount} 位用户使用中
        {policy.isDefault && '（含未单独指派的用户）'}
      </div>
    </div>
  )
}
