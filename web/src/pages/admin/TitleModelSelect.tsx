import { Link } from 'react-router-dom'
import type { AdminModelDTO } from '@shared/types/api'
import { Select } from '../../components/ui/Select'

type TitleModel = Pick<AdminModelDTO, 'id' | 'displayName' | 'providerName' | 'modelId' | 'kind'>

/** 按可见信息判断重名，也覆盖两个供应商恰好同名的情况。 */
const modelIdentity = (model: TitleModel) =>
  JSON.stringify([model.displayName, model.providerName, model.modelId])

export function TitleModelSelect({
  models,
  value,
  onChange,
}: {
  models: readonly TitleModel[]
  value: string
  onChange: (value: string) => void
}) {
  const textModels = models.filter((model) => model.kind !== 'image')
  const identityCounts = new Map<string, number>()
  for (const model of textModels) {
    const identity = modelIdentity(model)
    identityCounts.set(identity, (identityCounts.get(identity) ?? 0) + 1)
  }
  const selectedModel = textModels.find((model) => model.id === value)

  return (
    <div className="space-y-1.5">
      <Select
        label="标题模型"
        aria-label="标题模型"
        className="w-full"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        options={[
          { value: '', label: '自动（首个可用文本模型）' },
          ...textModels.map((model) => ({
            value: model.id,
            label: model.displayName,
            description: [
              model.providerName,
              model.modelId,
              // UUID v7 的前缀是时间；取随机尾段区分实例，避免列表排序变化后编号跟着变化。
              identityCounts.get(modelIdentity(model))! > 1 ? `配置 ${model.id.slice(-8)}` : null,
            ]
              .filter(Boolean)
              .join(' · '),
          })),
        ]}
      />
      {selectedModel && (
        <Link
          to={`/admin/models?edit=${encodeURIComponent(selectedModel.id)}`}
          className="inline-flex min-h-8 items-center text-xs text-sky-600 hover:underline dark:text-sky-400"
        >
          查看所选模型配置 →
        </Link>
      )}
    </div>
  )
}
