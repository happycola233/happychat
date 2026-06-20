import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { REASONING_EFFORTS } from '@shared/constants'
import { PROMPT_VARIABLES } from '@shared/util/promptTemplate'
import type { AdminModelDTO } from '@shared/types/api'
import type {
  ModelCapabilities,
  ModelParams,
  ModelPricing,
  ReasoningEffort,
} from '@shared/types/domain'
import * as adminApi from '../../api/admin'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Toggle } from '../../components/ui/Toggle'
import { toast } from '../../store/toast'

const fieldClass =
  'w-full rounded-xl border border-neutral-300 bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100'

const CAP_LABELS: Record<keyof ModelCapabilities, string> = {
  vision: '图片输入（视觉）',
  file_input: '文件输入',
  web_search: '联网搜索',
  image_generation: '图片生成',
  reasoning: '思考（reasoning）',
}

const EFFORT_LABELS: Record<ReasoningEffort, string> = {
  none: '关闭',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
}

const BLANK_CAPS: ModelCapabilities = {
  vision: false,
  file_input: false,
  web_search: false,
  image_generation: false,
  reasoning: false,
}

function numOrUndef(v: string): number | undefined {
  if (v.trim() === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/** model 为 null 时进入「新建」模式。 */
export function ModelEditor({ model, onClose }: { model: AdminModelDTO | null; onClose: () => void }) {
  const qc = useQueryClient()
  const isCreate = model === null

  const { data: providers } = useQuery({
    queryKey: ['admin', 'providers'],
    queryFn: adminApi.listProviders,
    enabled: isCreate,
  })

  const [providerId, setProviderId] = useState(model?.providerId ?? '')
  const [modelId, setModelId] = useState(model?.modelId ?? '')
  const [displayName, setDisplayName] = useState(model?.displayName ?? '')
  const [enabled, setEnabled] = useState(model?.enabled ?? true)
  const [kind, setKind] = useState(model?.kind ?? 'responses')
  const [caps, setCaps] = useState<ModelCapabilities>(model?.capabilities ?? BLANK_CAPS)
  const [systemPrompt, setSystemPrompt] = useState(model?.defaultSystemPrompt ?? '')
  const [allowedEfforts, setAllowedEfforts] = useState<ReasoningEffort[]>(model?.allowedEfforts ?? [])
  const [defaultEffort, setDefaultEffort] = useState<ReasoningEffort | ''>(model?.defaultEffort ?? '')
  const [defaultWebSearch, setDefaultWebSearch] = useState(model?.defaultWebSearch ?? false)
  const [params, setParams] = useState<ModelParams>(model?.defaultParams ?? {})
  const [pricing, setPricing] = useState<ModelPricing>(model?.pricing ?? {})
  const [hardParamsText, setHardParamsText] = useState(
    model?.hardParams ? JSON.stringify(model.hardParams, null, 2) : '',
  )

  const cleanedPricing = (): ModelPricing | null => {
    const p: ModelPricing = {}
    if (pricing.input != null) p.input = pricing.input
    if (pricing.cachedInput != null) p.cachedInput = pricing.cachedInput
    if (pricing.output != null) p.output = pricing.output
    if (pricing.image != null) p.image = pricing.image
    return Object.keys(p).length ? p : null
  }

  const parseHardParams = (): Record<string, unknown> | null => {
    const t = hardParamsText.trim()
    if (!t || t === '{}') return null
    let parsed: unknown
    try {
      parsed = JSON.parse(t)
    } catch {
      throw new Error('请求体硬参数不是合法 JSON')
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('请求体硬参数需为 JSON 对象')
    }
    return parsed as Record<string, unknown>
  }

  const save = useMutation({
    mutationFn: async () => {
      const shared = {
        displayName,
        kind,
        capabilities: caps,
        defaultSystemPrompt: systemPrompt.trim() ? systemPrompt : null,
        allowedEfforts: caps.reasoning ? allowedEfforts : [],
        defaultEffort: caps.reasoning && defaultEffort ? defaultEffort : null,
        defaultWebSearch: caps.web_search ? defaultWebSearch : false,
        defaultParams: {
          temperature: params.temperature,
          top_p: params.top_p,
          verbosity: params.verbosity,
          max_output_tokens: params.max_output_tokens,
        },
        pricing: cleanedPricing(),
        hardParams: parseHardParams(),
      }
      if (isCreate) {
        await adminApi.createModel({ providerId, modelId: modelId.trim(), enabled, sort: 0, ...shared })
      } else {
        await adminApi.updateModel(model.id, { modelId: modelId.trim(), enabled, ...shared })
      }
    },
    onSuccess: () => {
      toast.success(isCreate ? '已添加模型' : '已保存')
      qc.invalidateQueries({ queryKey: ['admin', 'models'] })
      qc.invalidateQueries({ queryKey: ['models'] })
      onClose()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '保存失败'),
  })

  const toggleCap = (k: keyof ModelCapabilities) => setCaps((c) => ({ ...c, [k]: !c[k] }))
  const toggleEffort = (e: ReasoningEffort) =>
    setAllowedEfforts((arr) => (arr.includes(e) ? arr.filter((x) => x !== e) : [...arr, e]))

  const canSave = !isCreate || (Boolean(providerId) && modelId.trim() !== '' && displayName.trim() !== '')

  return (
    <Modal
      open
      onClose={onClose}
      title={isCreate ? '添加模型' : `配置模型 · ${model.modelId}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!canSave}>
            {isCreate ? '添加' : '保存'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {isCreate && (
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              所属供应商
            </span>
            <select
              className={fieldClass}
              value={providerId}
              onChange={(e) => setProviderId(e.target.value)}
            >
              <option value="">请选择供应商</option>
              {(providers ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              模型 ID（真实请求用）
            </span>
            <input
              className={fieldClass}
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              placeholder="如 gpt-5.5"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              显示名称（外显）
            </span>
            <input
              className={fieldClass}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="如 GPT-5.5"
            />
          </label>
        </div>

        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
            在用户端启用
          </label>
          <Toggle checked={enabled} onChange={setEnabled} />
        </div>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
            类型
          </span>
          <select
            className={fieldClass}
            value={kind}
            onChange={(e) => setKind(e.target.value as 'responses' | 'chat' | 'image')}
          >
            <option value="responses">对话模型（Responses API）</option>
            <option value="chat">对话模型（chat/completions）</option>
            <option value="image">图片生成模型</option>
          </select>
        </label>

        <div>
          <span className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
            能力
          </span>
          <div className="space-y-2">
            {(Object.keys(CAP_LABELS) as (keyof ModelCapabilities)[]).map((k) => (
              <label key={k} className="flex items-center justify-between text-sm">
                <span className="text-neutral-600 dark:text-neutral-300">{CAP_LABELS[k]}</span>
                <Toggle checked={caps[k]} onChange={() => toggleCap(k)} />
              </label>
            ))}
          </div>
        </div>

        {caps.reasoning && (
          <div className="rounded-xl bg-neutral-50 p-3 dark:bg-neutral-800/50">
            <span className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              思考等级
            </span>
            <div className="mb-3 flex flex-wrap gap-2">
              {REASONING_EFFORTS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => toggleEffort(e)}
                  className={`rounded-lg border px-3 py-1 text-xs transition ${
                    allowedEfforts.includes(e)
                      ? 'border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900'
                      : 'border-neutral-300 text-neutral-500 dark:border-neutral-600'
                  }`}
                >
                  {EFFORT_LABELS[e]}
                </button>
              ))}
            </div>
            <label className="block">
              <span className="mb-1.5 block text-xs text-neutral-500">默认思考等级</span>
              <select
                className={fieldClass}
                value={defaultEffort}
                onChange={(e) => setDefaultEffort(e.target.value as ReasoningEffort | '')}
              >
                <option value="">未设置</option>
                {allowedEfforts.map((e) => (
                  <option key={e} value={e}>
                    {EFFORT_LABELS[e]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {caps.web_search && (
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
              默认开启联网搜索
            </label>
            <Toggle checked={defaultWebSearch} onChange={setDefaultWebSearch} />
          </div>
        )}

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
            默认系统提示词
          </span>
          <textarea
            className={`${fieldClass} min-h-[80px] resize-y`}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="可选，作为该模型的默认 system 指令；支持下方变量"
          />
          <div className="mt-2 rounded-lg bg-neutral-50 p-2.5 text-xs dark:bg-neutral-800/50">
            <div className="mb-1.5 text-neutral-500">可用变量（请求时按当前用户/模型/时间自动替换）：</div>
            <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
              {PROMPT_VARIABLES.map((v) => (
                <div key={v.name} className="flex min-w-0 items-baseline gap-1.5">
                  <code className="shrink-0 rounded bg-neutral-200/70 px-1 font-mono text-[11px] text-neutral-700 dark:bg-neutral-700/60 dark:text-neutral-200">
                    {`{{${v.name}}}`}
                  </code>
                  <span className="truncate text-neutral-400">{v.description}</span>
                </div>
              ))}
            </div>
          </div>
        </label>

        {kind === 'responses' && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-xs text-neutral-500">temperature</span>
              <input
                className={fieldClass}
                type="number"
                step="0.1"
                value={params.temperature ?? ''}
                onChange={(e) =>
                  setParams((p) => ({ ...p, temperature: numOrUndef(e.target.value) }))
                }
                placeholder="默认"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs text-neutral-500">top_p</span>
              <input
                className={fieldClass}
                type="number"
                step="0.05"
                value={params.top_p ?? ''}
                onChange={(e) => setParams((p) => ({ ...p, top_p: numOrUndef(e.target.value) }))}
                placeholder="默认"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs text-neutral-500">verbosity</span>
              <select
                className={fieldClass}
                value={params.verbosity ?? ''}
                onChange={(e) =>
                  setParams((p) => ({
                    ...p,
                    verbosity: (e.target.value || undefined) as ModelParams['verbosity'],
                  }))
                }
              >
                <option value="">默认</option>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs text-neutral-500">max_output_tokens</span>
              <input
                className={fieldClass}
                type="number"
                value={params.max_output_tokens ?? ''}
                onChange={(e) =>
                  setParams((p) => ({ ...p, max_output_tokens: numOrUndef(e.target.value) }))
                }
                placeholder="默认"
              />
            </label>
          </div>
        )}

        <div className="rounded-xl bg-neutral-50 p-3 dark:bg-neutral-800/50">
          <span className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
            定价（USD / 每 100 万 tokens）
          </span>
          <p className="mb-3 text-xs text-neutral-400">用于成本估算，留空的项不计入成本。</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-xs text-neutral-500">输入 input</span>
              <input
                className={fieldClass}
                type="number"
                step="0.01"
                min="0"
                value={pricing.input ?? ''}
                onChange={(e) => setPricing((p) => ({ ...p, input: numOrUndef(e.target.value) }))}
                placeholder="未设置"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs text-neutral-500">缓存输入 cached</span>
              <input
                className={fieldClass}
                type="number"
                step="0.01"
                min="0"
                value={pricing.cachedInput ?? ''}
                onChange={(e) =>
                  setPricing((p) => ({ ...p, cachedInput: numOrUndef(e.target.value) }))
                }
                placeholder="未设置"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs text-neutral-500">输出 output</span>
              <input
                className={fieldClass}
                type="number"
                step="0.01"
                min="0"
                value={pricing.output ?? ''}
                onChange={(e) => setPricing((p) => ({ ...p, output: numOrUndef(e.target.value) }))}
                placeholder="未设置"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs text-neutral-500">图片 image</span>
              <input
                className={fieldClass}
                type="number"
                step="0.01"
                min="0"
                value={pricing.image ?? ''}
                onChange={(e) => setPricing((p) => ({ ...p, image: numOrUndef(e.target.value) }))}
                placeholder="未设置"
              />
            </label>
          </div>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
            高级：请求体硬参数（JSON）
          </span>
          <textarea
            className={`${fieldClass} min-h-[90px] resize-y font-mono text-xs`}
            value={hardParamsText}
            onChange={(e) => setHardParamsText(e.target.value)}
            placeholder={'例如 {"reasoning":{"summary":"auto"}}'}
            spellCheck={false}
          />
          <p className="mt-1 text-xs text-neutral-400">
            会按「硬参数 &gt; 用户参数 &gt; 模型默认」深度合并进上游请求体，完全可控（如
            summary、store、include 等）。留空表示无。
          </p>
        </label>
      </div>
    </Modal>
  )
}
