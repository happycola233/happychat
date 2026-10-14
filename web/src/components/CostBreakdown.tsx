import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ChevronDown, CircleAlert, X } from 'lucide-react'
import type { MessageCostDisplayDTO } from '@shared/types/api'
import type { RequestCostBreakdown } from '@shared/types/domain'
import { costDisplayCurrency, formatCostAmount, requestCostDisplay } from '../lib/costDisplay'
import { getBillingCurrency } from '../store/billingCurrency'
import { formatCurrency } from '../lib/format'

/** 原生浮层脱离排版并进入顶层，避免撑高用量行或被后台表格裁切。 */
export function CostBreakdown({
  breakdown,
  display,
  showUnpricedNotice = true,
  children,
}: {
  breakdown?: RequestCostBreakdown | null
  display?: MessageCostDisplayDTO
  showUnpricedNotice?: boolean
  children: ReactNode
}) {
  const id = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<CSSProperties>()

  useLayoutEffect(() => {
    if (!open) return
    const updatePosition = () => {
      const trigger = triggerRef.current!.getBoundingClientRect()
      const panel = panelRef.current!
      const padding = 12
      const gap = 8
      const width = Math.min(280, window.innerWidth - padding * 2)
      const below = window.innerHeight - trigger.bottom - gap - padding
      const above = trigger.top - gap - padding
      const placeBelow = below >= panel.scrollHeight || below >= above
      setPosition({
        width,
        left: Math.max(
          padding,
          Math.min(trigger.right - width, window.innerWidth - width - padding),
        ),
        top: placeBelow ? trigger.bottom + gap : undefined,
        bottom: placeBelow ? undefined : window.innerHeight - trigger.top + gap,
        maxHeight: Math.max(0, placeBelow ? below : above),
      })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open])

  if (
    !breakdown ||
    (!breakdown.charges?.length &&
      breakdown.imageCount === 0 &&
      breakdown.imageStatus === 'complete' &&
      breakdown.imageUsd === 0)
  )
    return <>{children}</>
  // 未配置价格的图片在用户端按免费展示，配置提醒只留在管理端。
  const incomplete =
    breakdown.imageStatus === 'missing_usage' ||
    (showUnpricedNotice && breakdown.imageStatus === 'missing_pricing')
  const resolvedDisplay = requestCostDisplay(
    display ?? { currency: getBillingCurrency(), usdToCnyRate: null },
    breakdown,
  )
  const currency = costDisplayCurrency(resolvedDisplay)
  const amount = (usd: number) => formatCostAmount(usd, resolvedDisplay)
  const hasImages =
    breakdown.imageCount > 0 || breakdown.imageUsd > 0 || breakdown.imageStatus !== 'complete'
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        popoverTarget={id}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={incomplete ? '查看费用明细，图片费用未完整统计' : '查看费用明细'}
        className="inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded align-top tabular-nums transition-colors hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50 dark:hover:text-neutral-200"
      >
        {children}
        {incomplete ? (
          <CircleAlert
            aria-hidden="true"
            size={14}
            strokeWidth={1.5}
            absoluteStrokeWidth
            className="block shrink-0 text-amber-500 dark:text-amber-400"
          />
        ) : (
          <ChevronDown
            aria-hidden="true"
            size={14}
            strokeWidth={1.5}
            absoluteStrokeWidth
            className={`block shrink-0 text-neutral-500 transition-transform dark:text-neutral-400 ${open ? 'rotate-180' : ''}`}
          />
        )}
      </button>
      <div
        id={id}
        ref={panelRef}
        popover="auto"
        role="dialog"
        aria-labelledby={`${id}-title`}
        onToggle={(event) => setOpen(event.newState === 'open')}
        style={{ ...position, visibility: open && position ? 'visible' : 'hidden' }}
        className="fixed inset-auto m-0 w-[280px] max-w-[calc(100vw-24px)] overflow-y-auto overscroll-contain rounded-xl border-0 bg-white p-4 text-left text-xs leading-5 font-normal whitespace-normal text-neutral-600 shadow-lg ring-1 ring-black/10 dark:bg-neutral-900 dark:text-neutral-300 dark:ring-white/10"
      >
        <div className="mb-3 flex items-center gap-2">
          <h3
            id={`${id}-title`}
            className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100"
          >
            费用明细
          </h3>
          <span className="text-[11px] text-neutral-400">{currency}</span>
          <button
            type="button"
            popoverTarget={id}
            popoverTargetAction="hide"
            aria-label="关闭费用明细"
            className="-mr-1.5 -my-1.5 ml-auto inline-flex size-7 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50 dark:hover:bg-neutral-800"
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        </div>
        <dl className="space-y-2">
          <div className="flex items-baseline justify-between gap-4">
            <dt>聊天</dt>
            <dd className="font-medium tabular-nums text-neutral-900 dark:text-neutral-100">
              {amount(breakdown.chatUsd)}
            </dd>
          </div>
          {hasImages && (
            <>
              <div className="flex items-baseline justify-between gap-4">
                <dt>
                  图片生成
                  {incomplete && (
                    <span className="ml-1 text-[11px] text-neutral-400">（已统计）</span>
                  )}
                </dt>
                <dd className="font-medium tabular-nums text-neutral-900 dark:text-neutral-100">
                  {amount(breakdown.imageUsd)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 text-neutral-400 dark:text-neutral-500">
                <dt>计费图片</dt>
                <dd className="tabular-nums">{breakdown.imageCount} 张</dd>
              </div>
            </>
          )}
          <div className="flex items-baseline justify-between gap-4 border-t border-neutral-100 pt-2 font-medium text-neutral-900 dark:border-neutral-800 dark:text-neutral-100">
            <dt>{incomplete ? '已统计合计' : '合计'}</dt>
            <dd className="tabular-nums">{amount(breakdown.totalUsd)}</dd>
          </div>
        </dl>
        {!!breakdown.charges?.length && (
          <div className="mt-3 space-y-3 border-t border-neutral-100 pt-3 dark:border-neutral-800">
            {breakdown.charges.map((charge, index) => (
              <div key={index}>
                <div className="flex justify-between gap-2">
                  <span>
                    {charge.kind === 'chat' ? '聊天' : '生图'} · {charge.period}
                  </span>
                  <span className="tabular-nums">
                    {formatCurrency(charge.amount, charge.currency)} {charge.currency}
                  </span>
                </div>
                {charge.inputTokens !== undefined && (
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                    输入 {charge.inputTokens.toLocaleString()} Token
                    {charge.aboveInputTokens !== undefined
                      ? ` · 超过 ${charge.aboveInputTokens.toLocaleString()} 档`
                      : ' · 基础上下文档'}
                  </p>
                )}
                {charge.unitPrices && (
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                    每百万 Token：输入 {charge.unitPrices.input ?? 0} · 输出{' '}
                    {charge.unitPrices.output ?? 0} · 缓存读取 {charge.unitPrices.cachedInput ?? 0}{' '}
                    · 缓存写入 {charge.unitPrices.cacheWriteInput ?? 0} {charge.currency}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
        {incomplete && (
          <div className="mt-3 border-t border-neutral-100 pt-3 dark:border-neutral-800">
            <p className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
              <CircleAlert
                aria-hidden="true"
                size={14}
                strokeWidth={1.5}
                absoluteStrokeWidth
                className="block shrink-0"
              />
              图片费用未完整统计
            </p>
            <p className="mt-1 text-neutral-500 dark:text-neutral-400">
              {breakdown.imageStatus === 'missing_usage'
                ? '供应商未返回完整生图用量或图片规格。'
                : '部分图片尚未配置可用价格。'}
            </p>
          </div>
        )}
        {(currency === 'CNY' || breakdown.exchangeRate) && (
          <p className="mt-3 text-[11px] text-neutral-400">
            {breakdown.exchangeRate
              ? `请求汇率：1 USD ≈ ${breakdown.exchangeRate.usdToCny} CNY · 获取于 ${new Date(breakdown.exchangeRate.fetchedAt).toLocaleString('zh-CN')}`
              : `旧账按固定基准折算 · 美元合计 ${formatCostAmount(breakdown.totalUsd)}`}
          </p>
        )}
      </div>
    </>
  )
}
