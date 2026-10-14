import type { ReactNode } from 'react'
import type { ModelPricing, PricingTable } from '@shared/types/domain'
import { pricingSchema } from '@shared/schemas/model-config'
import { PRICING_TIMEZONE } from '@shared/util/pricing'
import { createRandomUuid } from '../../lib/randomUuid'
import { inputClass } from '../../components/ui/controlStyles'
import { pricingHintClass } from './PricingFields'

export function PricingScheduleEditor({
  pricing,
  onChange,
  renderTable,
}: {
  pricing: ModelPricing
  onChange: (pricing: ModelPricing) => void
  renderTable: (table: PricingTable, onChange: (table: PricingTable) => void) => ReactNode
}) {
  const periods = pricing.periods ?? []
  const validation = pricingSchema.safeParse(pricing)
  const periodError = validation.success
    ? null
    : validation.error.issues.find(
        (issue) =>
          issue.path[0] === 'periods' ||
          issue.path[0] === 'timezone' ||
          issue.path[0] === 'excludedDates',
      )?.message
  return (
    <section
      aria-label="分时定价"
      className="space-y-4 border-t border-neutral-200 pt-5 dark:border-neutral-800"
    >
      <div>
        <h3 className="text-sm font-semibold">分时定价</h3>
        <p className={pricingHintClass}>
          为高峰或低谷设置独立价格，其他时间使用基础价格。以每次调用开始的时间为准。
        </p>
      </div>
      {periods.length > 0 && (
        <>
          <label className="block text-xs text-neutral-500 dark:text-neutral-400">
            计费时区
            <input
              aria-label="计费时区"
              className={`${inputClass} mt-1.5`}
              list="pricing-timezones"
              value={pricing.timezone ?? PRICING_TIMEZONE}
              onChange={(event) => onChange({ ...pricing, timezone: event.target.value })}
            />
          </label>
          <datalist id="pricing-timezones">
            <option value="Asia/Shanghai" label="北京时间（UTC+8）" />
            <option value="UTC" label="协调世界时" />
            <option value="America/New_York" label="美国东部时间（纽约）" />
          </datalist>
          {periods.map((period, index) => {
            const update = (patch: Partial<typeof period>) =>
              onChange({
                ...pricing,
                periods: periods.map((item, i) => (i === index ? { ...item, ...patch } : item)),
              })
            return (
              <details
                key={period.id}
                open
                className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800"
              >
                <summary className="cursor-pointer text-sm font-medium">
                  {period.label || '新时段'} · {period.start}–{period.end}
                  {period.end < period.start ? '（次日）' : ''}
                </summary>
                <div className="mt-4 space-y-4">
                  <div className="flex items-center gap-3">
                    <input
                      aria-label={`时段 ${index + 1} 名称`}
                      className={inputClass}
                      value={period.label}
                      placeholder="例如 低谷时段"
                      onChange={(event) => update({ label: event.target.value })}
                    />
                    <button
                      type="button"
                      className="shrink-0 text-xs text-red-600 dark:text-red-400"
                      onClick={() =>
                        onChange({
                          ...pricing,
                          periods: periods.filter((item) => item.id !== period.id),
                        })
                      }
                    >
                      删除时段
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-xs text-neutral-500 dark:text-neutral-400">
                      开始时间
                      <input
                        aria-label={`时段 ${index + 1} 开始时间`}
                        type="time"
                        className={`${inputClass} mt-1.5`}
                        value={period.start}
                        onChange={(event) => update({ start: event.target.value })}
                      />
                    </label>
                    <label className="text-xs text-neutral-500 dark:text-neutral-400">
                      结束时间
                      <input
                        aria-label={`时段 ${index + 1} 结束时间`}
                        className={`${inputClass} mt-1.5`}
                        value={period.end}
                        placeholder="24:00"
                        onChange={(event) => update({ end: event.target.value })}
                      />
                    </label>
                  </div>
                  <fieldset>
                    <legend className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
                      生效星期
                    </legend>
                    <div className="flex flex-wrap gap-2">
                      {['一', '二', '三', '四', '五', '六', '日'].map((label, i) => (
                        <button
                          key={label}
                          type="button"
                          aria-pressed={period.weekdays.includes(i + 1)}
                          className={`rounded-md px-2.5 py-1.5 text-xs ${period.weekdays.includes(i + 1) ? 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200' : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400'}`}
                          onClick={() =>
                            update({
                              weekdays: period.weekdays.includes(i + 1)
                                ? period.weekdays.filter((day) => day !== i + 1)
                                : [...period.weekdays, i + 1],
                            })
                          }
                        >
                          周{label}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  {renderTable(period.pricing, (table) => update({ pricing: table }))}
                </div>
              </details>
            )
          })}
          <details>
            <summary className="cursor-pointer text-xs text-neutral-500 dark:text-neutral-400">
              指定日期使用基础价格
            </summary>
            <div className="mt-3 space-y-2">
              <p className={pricingHintClass}>
                例如节假日。所选日期全天使用基础价格，日期按上方计费时区计算。
              </p>
              {(pricing.excludedDates ?? []).map((date, index) => (
                <div key={index} className="flex items-center gap-3">
                  <input
                    type="date"
                    aria-label={`基础价格日期 ${index + 1}`}
                    className={inputClass}
                    value={date}
                    onChange={(event) =>
                      onChange({
                        ...pricing,
                        excludedDates: pricing.excludedDates!.map((value, i) =>
                          i === index ? event.target.value : value,
                        ),
                      })
                    }
                  />
                  <button
                    type="button"
                    className="shrink-0 text-xs text-red-600 dark:text-red-400"
                    onClick={() =>
                      onChange({
                        ...pricing,
                        excludedDates: pricing.excludedDates!.filter((_, i) => i !== index),
                      })
                    }
                  >
                    删除日期
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="text-sm text-sky-600 hover:underline dark:text-sky-400"
                onClick={() =>
                  onChange({ ...pricing, excludedDates: [...(pricing.excludedDates ?? []), ''] })
                }
              >
                添加日期
              </button>
            </div>
          </details>
        </>
      )}
      {periodError && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {periodError}
        </p>
      )}
      <button
        type="button"
        className="text-sm text-sky-600 hover:underline dark:text-sky-400"
        onClick={() =>
          onChange({
            ...pricing,
            timezone: pricing.timezone ?? PRICING_TIMEZONE,
            periods: [
              ...periods,
              {
                id: createRandomUuid(),
                label: '低谷时段',
                weekdays: [1, 2, 3, 4, 5, 6, 7],
                start: '00:00',
                end: '08:00',
                pricing: structuredClone({
                  input: pricing.input,
                  output: pricing.output,
                  cachedInput: pricing.cachedInput,
                  cacheWriteInput: pricing.cacheWriteInput,
                  contextTiers: pricing.contextTiers,
                  imageGeneration: pricing.imageGeneration,
                }),
              },
            ],
          })
        }
      >
        添加定价时段
      </button>
    </section>
  )
}
