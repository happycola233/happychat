import { useId, useState } from 'react'
import type { AdminModelDTO } from '@shared/types/api'
import type { ImageGenerationPricing, ModelKind, ModelPricing } from '@shared/types/domain'
import { normalizeModelPricing } from '@shared/util/cost'
import { inputClass } from '../../components/ui/controlStyles'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { Select, type SelectOption } from '../../components/ui/Select'

const pricingLabelClass = 'mb-1.5 block text-xs leading-4 text-neutral-500 dark:text-neutral-400'

function PriceInput({
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
      <label className={pricingLabelClass} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={`${inputClass} tabular-nums`}
        type="number"
        min="0"
        step="any"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        placeholder={placeholder}
      />
      {hint && (
        <p id={`${id}-hint`} className={`mt-1 ${hintClass}`}>
          {hint}
        </p>
      )}
    </div>
  )
}

const gridClass = 'grid grid-cols-1 items-end gap-4 sm:grid-cols-2'
const hintClass = 'text-xs leading-5 text-neutral-500 dark:text-neutral-400'

const sizeOptions: SelectOption[] = [
  { value: '1024x1024', label: '1024 × 1024 · 正方形' },
  { value: '1536x1024', label: '1536 × 1024 · 横图' },
  { value: '1024x1536', label: '1024 × 1536 · 竖图' },
]
const qualityOptions: SelectOption[] = [
  { value: 'low', label: '低 · low' },
  { value: 'medium', label: '中 · medium' },
  { value: 'high', label: '高 · high' },
  { value: 'xhigh', label: '超高 · xhigh' },
  { value: 'max', label: '最高 · max' },
  { value: 'standard', label: '标准 · standard' },
  { value: 'hd', label: '高清 · hd' },
]

/** 常用条件直接选择；空字符串只作为尚未填完的自定义草稿，保存时仍由 schema 校验。 */
function PricingCondition({
  label,
  value,
  options,
  onChange,
  placeholder,
  hint,
}: {
  label: string
  value: string | undefined
  options: SelectOption[]
  onChange: (value: string | undefined) => void
  placeholder: string
  hint: string
}) {
  const id = useId()
  const [editingCustom, setEditingCustom] = useState(false)
  const custom =
    editingCustom || (value !== undefined && !options.some((option) => option.value === value))
  return (
    <div className="min-w-0 space-y-2">
      <div>
        <label className={pricingLabelClass} htmlFor={id}>
          {label}
        </label>
        <Select
          id={id}
          aria-label={label}
          className="w-full"
          value={custom ? 'custom' : (value ?? '')}
          options={[
            { value: '', label: `所有${label}` },
            ...options,
            { value: 'custom', label: `自定义${label}…` },
          ]}
          onChange={(event) => {
            setEditingCustom(event.target.value === 'custom')
            onChange(event.target.value === 'custom' ? '' : event.target.value || undefined)
          }}
        />
      </div>
      {custom && (
        <div>
          <input
            aria-label={`自定义${label}`}
            className={inputClass}
            value={value}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
          />
          <p className={`mt-1 ${hintClass}`}>{hint}</p>
        </div>
      )}
    </div>
  )
}

export function ModelPricingEditor({
  kind,
  pricing,
  onChange,
  providerId,
  models,
}: {
  kind: ModelKind
  pricing: ModelPricing
  onChange: (pricing: ModelPricing) => void
  providerId: string
  models: AdminModelDTO[]
}) {
  const sources = models.filter(
    (model) => model.providerId === providerId && model.kind === 'image',
  )
  const source = sources.find((model) => model.id === pricing.imagePricingModelId)
  const imagePricing = source
    ? normalizeModelPricing(source.pricing, 'image').imageGeneration
    : pricing.imageGeneration
  const setImage = (value: ImageGenerationPricing | undefined) =>
    onChange({ ...pricing, imageGeneration: value, imagePricingModelId: undefined })
  const showImage =
    kind === 'image' || Boolean(pricing.imageGeneration || pricing.imagePricingModelId)

  return (
    <div className="space-y-7">
      {kind !== 'image' && (
        <section aria-label="聊天费用" className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold">聊天费用</h3>
            <p className={hintClass}>USD / 百万 Token · 输出包含思考用量</p>
          </div>
          <div className={gridClass}>
            {(
              [
                ['input', '普通输入'],
                ['output', '输出'],
                ['cachedInput', '缓存读取'],
                ['cacheWriteInput', '缓存写入'],
              ] as const
            ).map(([key, label]) => (
              <PriceInput
                key={key}
                label={label}
                value={pricing[key]}
                placeholder={
                  key === 'cachedInput' || key === 'cacheWriteInput' ? '沿用普通输入价格' : '未设置'
                }
                onChange={(value) => onChange({ ...pricing, [key]: value })}
              />
            ))}
          </div>
        </section>
      )}

      {(kind === 'image' || kind === 'responses') && (
        <section
          aria-label="图片生成费用"
          className="space-y-4 border-t border-neutral-200 pt-5 first:border-0 first:pt-0 dark:border-neutral-800"
        >
          <div>
            <h3 className="text-sm font-semibold">图片生成费用</h3>
            <p className={hintClass}>
              {kind === 'image'
                ? '仅计算图片生成费用'
                : '调用生图工具时单独计算，计入本次请求总费用'}
            </p>
          </div>
          {!showImage ? (
            <button
              type="button"
              className="text-sm text-sky-600 hover:underline dark:text-sky-400"
              onClick={() => setImage({ mode: 'per_image' })}
            >
              配置图片生成定价
            </button>
          ) : (
            <>
              <div className={gridClass}>
                {kind === 'responses' && (
                  <Select
                    label="生图定价来源"
                    className="w-full"
                    value={pricing.imagePricingModelId ?? ''}
                    options={[
                      { value: '', label: '自定义生图定价' },
                      ...sources.map((model) => ({
                        value: model.id,
                        label: `使用 ${model.displayName} 的定价`,
                      })),
                      ...(pricing.imagePricingModelId && !source
                        ? [
                            {
                              value: pricing.imagePricingModelId,
                              label: '定价来源已不可用，请重新选择',
                            },
                          ]
                        : []),
                    ]}
                    onChange={(e) =>
                      onChange({
                        ...pricing,
                        imagePricingModelId: e.target.value || undefined,
                        imageGeneration: e.target.value ? undefined : { mode: 'per_image' },
                      })
                    }
                  />
                )}
                {!pricing.imagePricingModelId && (
                  <fieldset className="min-w-0">
                    <legend className="mb-1.5 text-xs text-neutral-500">计价方式</legend>
                    <SegmentedControl
                      label="生图计价方式"
                      className="align-top"
                      value={imagePricing?.mode ?? 'tokens'}
                      options={[
                        { value: 'tokens', label: '按 Token' },
                        { value: 'per_image', label: '按张' },
                      ]}
                      onChange={(mode) => {
                        if (mode !== imagePricing?.mode) setImage({ mode })
                      }}
                    />
                  </fieldset>
                )}
              </div>
              {pricing.imagePricingModelId ? (
                <div className="rounded-xl bg-neutral-50 p-4 text-sm dark:bg-neutral-900">
                  {source ? (
                    <>
                      <p>
                        {source.displayName} ·{' '}
                        {imagePricing?.mode === 'per_image' ? '按张计价' : '按 Token 计价'}
                      </p>
                      <p className={`mt-1 ${hintClass}`}>
                        后续新请求使用该模型的最新生图价格。此处只引用价格，不改变实际调用的生图模型。
                      </p>
                    </>
                  ) : (
                    <p className={hintClass}>请选择可用的定价来源，或改用自定义定价。</p>
                  )}
                </div>
              ) : (
                <>
                  {imagePricing?.mode === 'per_image' ? (
                    <>
                      <div className={gridClass}>
                        <PriceInput
                          label="默认每张价格（USD / 张）"
                          value={imagePricing.price}
                          onChange={(price) => setImage({ ...imagePricing, price })}
                        />
                      </div>
                      <p className={hintClass}>
                        图片费用按最终生成张数 × 每张单价计算，预览图不计入张数。
                      </p>
                      <details open={imagePricing.tiers?.length ? true : undefined}>
                        <summary className="cursor-pointer text-sm">
                          按尺寸或质量设置不同价格
                        </summary>
                        <div className="mt-3 space-y-3">
                          <p className={hintClass}>
                            选择供应商收费的尺寸或质量，再填写每张价格。选择“所有”表示不限该项；其他图片使用默认单价。
                          </p>
                          <p className={hintClass}>
                            例如：只给正方形图片定价，可选“1024 × 1024 · 正方形”和“所有质量”。
                          </p>
                          {(imagePricing.tiers ?? []).map((tier, index) => {
                            const update = (patch: Partial<typeof tier>) =>
                              setImage({
                                ...imagePricing,
                                tiers: imagePricing.tiers!.map((row, i) =>
                                  i === index ? { ...row, ...patch } : row,
                                ),
                              })
                            return (
                              <div
                                key={index}
                                className="grid grid-cols-2 items-start gap-3 border-t border-neutral-200 pt-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_2.25rem] dark:border-neutral-800"
                              >
                                <PricingCondition
                                  label="尺寸"
                                  value={tier.size}
                                  options={sizeOptions}
                                  onChange={(size) => update({ size })}
                                  placeholder="例如 2048x2048"
                                  hint="填写宽x高（像素），例如 2048x2048。"
                                />
                                <PricingCondition
                                  label="质量"
                                  value={tier.quality}
                                  options={qualityOptions}
                                  onChange={(quality) => update({ quality })}
                                  placeholder="例如 ultra"
                                  hint="填写供应商使用的质量名称，需与返回值一致。"
                                />
                                <PriceInput
                                  label="每张价格（USD）"
                                  value={tier.price}
                                  placeholder="例如 0.05"
                                  hint="按供应商报价填写，0 表示免费。"
                                  onChange={(price) => update({ price: price ?? 0 })}
                                />
                                <div className="justify-self-end">
                                  <span
                                    aria-hidden="true"
                                    className={`${pricingLabelClass} invisible`}
                                  >
                                    操作
                                  </span>
                                  <button
                                    type="button"
                                    aria-label={`删除价格档位 ${index + 1}`}
                                    className="min-h-9 w-9 text-xs text-neutral-500 hover:text-red-600 dark:text-neutral-400 dark:hover:text-red-400"
                                    onClick={() =>
                                      setImage({
                                        ...imagePricing,
                                        tiers: imagePricing.tiers!.filter((_, i) => i !== index),
                                      })
                                    }
                                  >
                                    删除
                                  </button>
                                </div>
                                {!tier.size && !tier.quality && (
                                  <p className={`col-span-full ${hintClass}`}>
                                    请至少选择一个具体尺寸或质量；统一价格请填写上方的默认每张价格。
                                  </p>
                                )}
                              </div>
                            )
                          })}
                          <button
                            type="button"
                            className="text-sm text-sky-600 hover:underline dark:text-sky-400"
                            onClick={() =>
                              setImage({
                                ...imagePricing,
                                tiers: [
                                  ...(imagePricing.tiers ?? []),
                                  { price: imagePricing.price ?? 0 },
                                ],
                              })
                            }
                          >
                            添加价格档位
                          </button>
                          <p className={hintClass}>
                            多条价格同时适用时，优先使用同时指定尺寸与质量的价格，其次是尺寸，再其次是质量。
                          </p>
                        </div>
                      </details>
                    </>
                  ) : (
                    <>
                      <p className={hintClass}>USD / 百万 Token · 使用生图模型独立返回的用量</p>
                      <div className={gridClass}>
                        {(
                          [
                            ['textInput', '文字提示词输入'],
                            ['imageInput', '参考图片输入'],
                            ['imageOutput', '图片输出'],
                          ] as const
                        ).map(([key, label]) => (
                          <PriceInput
                            key={key}
                            label={label}
                            value={imagePricing?.[key]}
                            onChange={(value) =>
                              setImage({ ...imagePricing, mode: 'tokens', [key]: value })
                            }
                          />
                        ))}
                      </div>
                      <details className="text-sm">
                        <summary className="cursor-pointer text-neutral-500">缓存价格</summary>
                        <div className={`${gridClass} mt-3`}>
                          {(
                            [
                              ['cachedTextInput', '文字缓存读取'],
                              ['cachedImageInput', '图片缓存读取'],
                            ] as const
                          ).map(([key, label]) => (
                            <PriceInput
                              key={key}
                              label={label}
                              value={imagePricing?.[key]}
                              placeholder="沿用对应输入价格"
                              onChange={(value) =>
                                setImage({ ...imagePricing, mode: 'tokens', [key]: value })
                              }
                            />
                          ))}
                        </div>
                      </details>
                      <p className={hintClass}>
                        未回传的用量会标记为费用未完整统计。缓存折扣以供应商账单为准。
                      </p>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </section>
      )}
    </div>
  )
}
