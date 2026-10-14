import { useId } from 'react'
import type { ContextPricingTier, TokenPricing } from '@shared/types/domain'
import { inputClass } from '../../components/ui/controlStyles'

export const pricingHintClass = 'text-xs leading-5 text-neutral-500 dark:text-neutral-400'
export function PriceInput({
  label,
  value,
  onChange,
  placeholder = '未设置',
  hint,
}: {
  label: string
  value: number | undefined
  onChange: (value: number | undefined) => void
  placeholder?: string
  hint?: string
}) {
  const id = useId()
  return (
    <div className="min-w-0">
      <label
        className="mb-1.5 block text-xs leading-4 text-neutral-500 dark:text-neutral-400"
        htmlFor={id}
      >
        {label}
      </label>
      <input
        id={id}
        className={`${inputClass} tabular-nums`}
        type="number"
        min="0"
        step="any"
        value={value ?? ''}
        onChange={(event) =>
          onChange(event.target.value === '' ? undefined : Number(event.target.value))
        }
        placeholder={placeholder}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      {hint && (
        <p id={`${id}-hint`} className={`mt-1 ${pricingHintClass}`}>
          {hint}
        </p>
      )}
    </div>
  )
}

export function TokenPriceFields({
  prices,
  onChange,
}: {
  prices: TokenPricing
  onChange: (prices: TokenPricing) => void
}) {
  return (
    <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-2">
      {(
        [
          ['input', '普通输入', '未设置'],
          ['output', '输出', '未设置'],
          ['cachedInput', '缓存读取', '沿用普通输入价格'],
          ['cacheWriteInput', '缓存写入', '0'],
        ] as const
      ).map(([key, label, placeholder]) => (
        <PriceInput
          key={key}
          label={label}
          value={prices[key]}
          placeholder={placeholder}
          onChange={(value) => onChange({ ...prices, [key]: value })}
        />
      ))}
    </div>
  )
}

export function ContextPricingEditor({
  tiers = [],
  prices,
  onChange,
}: {
  tiers?: ContextPricingTier[]
  prices: TokenPricing
  onChange: (tiers: ContextPricingTier[]) => void
}) {
  return (
    <details className="text-sm" open={tiers.length ? true : undefined}>
      <summary className="cursor-pointer py-1 font-medium">
        长上下文价格{tiers.length ? ` · ${tiers.length} 档` : ''}
      </summary>
      <div className="mt-3 space-y-4">
        <p className={pricingHintClass}>
          按单次请求的输入 Token
          总量（含缓存）选档，输入和输出均使用该档单价。等于阈值时仍使用较低档。
        </p>
        {tiers.map((tier, index) => (
          <div
            key={index}
            className="space-y-3 border-l-2 border-neutral-200 pl-4 dark:border-neutral-700"
          >
            <div className="flex items-end gap-3">
              <PriceInput
                label="输入超过（Token）"
                value={tier.aboveInputTokens}
                placeholder="例如 128000"
                onChange={(value) =>
                  onChange(
                    tiers.map((item, i) =>
                      i === index ? { ...item, aboveInputTokens: value ?? 0 } : item,
                    ),
                  )
                }
              />
              <button
                type="button"
                className="mb-2 text-xs text-red-600 dark:text-red-400"
                aria-label={`删除上下文档位 ${index + 1}`}
                onClick={() => onChange(tiers.filter((_, i) => i !== index))}
              >
                删除
              </button>
            </div>
            <TokenPriceFields
              prices={tier}
              onChange={(value) =>
                onChange(
                  tiers.map((item, i) =>
                    i === index ? { ...value, aboveInputTokens: tier.aboveInputTokens } : item,
                  ),
                )
              }
            />
          </div>
        ))}
        <button
          type="button"
          className="text-sm text-sky-600 hover:underline dark:text-sky-400"
          onClick={() =>
            onChange([
              ...tiers,
              {
                input: prices.input,
                output: prices.output,
                cachedInput: prices.cachedInput,
                cacheWriteInput: prices.cacheWriteInput,
                aboveInputTokens: tiers.length
                  ? Math.max(...tiers.map((tier) => tier.aboveInputTokens)) * 2
                  : 128000,
              },
            ])
          }
        >
          添加上下文档位
        </button>
      </div>
    </details>
  )
}
