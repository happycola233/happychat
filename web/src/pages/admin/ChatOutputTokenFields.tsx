import { useId } from 'react'
import type { ModelParams } from '@shared/types/domain'
import { inputClass } from '../../components/ui/controlStyles'
import { SmallField } from './FormField'

const fields = [
  {
    key: 'max_completion_tokens',
    description: 'OpenAI Chat Completions 当前推荐字段，包含正文与思考 token。',
  },
  { key: 'max_tokens', description: '旧版兼容字段，DeepSeek 等上游仍使用；OpenAI o 系列不支持。' },
] as const

export function ChatOutputTokenFields({
  params,
  onChange,
}: {
  params: ModelParams
  onChange: (params: ModelParams) => void
}) {
  const descriptionId = useId()
  return (
    <div className="col-span-full space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {fields.map(({ key, description }) => (
          <SmallField key={key} label={key}>
            <input
              className={`${inputClass} tabular-nums`}
              type="number"
              min={1}
              step={1}
              aria-describedby={`${descriptionId}-${key}`}
              value={params[key] ?? ''}
              placeholder="留空使用上游默认"
              onChange={(event) =>
                onChange({
                  ...params,
                  [key]: event.target.value === '' ? undefined : event.target.valueAsNumber,
                })
              }
            />
            <span
              id={`${descriptionId}-${key}`}
              className="mt-1.5 block text-xs leading-5 text-neutral-500 dark:text-neutral-400"
            >
              {description}
            </span>
          </SmallField>
        ))}
      </div>
      <p className="text-xs leading-5 text-neutral-500 dark:text-neutral-400">
        通常只填写上游支持的一项。填写哪个字段就按原名发送哪个字段，两项都留空时不发送输出上限；高级
        JSON 可按同名字段覆盖。
      </p>
    </div>
  )
}
