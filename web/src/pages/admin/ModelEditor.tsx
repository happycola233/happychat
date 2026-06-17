import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { REASONING_EFFORTS } from '@shared/constants'
import type { AdminModelDTO } from '@shared/types/api'
import type { ModelCapabilities, ModelParams, ReasoningEffort } from '@shared/types/domain'
import type { ModelUpdateInput } from '@shared/schemas/model-config'
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

function numOrUndef(v: string): number | undefined {
  if (v.trim() === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

export function ModelEditor({ model, onClose }: { model: AdminModelDTO; onClose: () => void }) {
  const qc = useQueryClient()
  const [displayName, setDisplayName] = useState(model.displayName)
  const [enabled, setEnabled] = useState(model.enabled)
  const [kind, setKind] = useState(model.kind)
  const [caps, setCaps] = useState<ModelCapabilities>(model.capabilities)
  const [systemPrompt, setSystemPrompt] = useState(model.defaultSystemPrompt ?? '')
  const [allowedEfforts, setAllowedEfforts] = useState<ReasoningEffort[]>(model.allowedEfforts)
  const [defaultEffort, setDefaultEffort] = useState<ReasoningEffort | ''>(
    model.defaultEffort ?? '',
  )
  const [defaultWebSearch, setDefaultWebSearch] = useState(model.defaultWebSearch)
  const [params, setParams] = useState<ModelParams>(model.defaultParams ?? {})

  const save = useMutation({
    mutationFn: () => {
      const payload: ModelUpdateInput = {
        displayName,
        enabled,
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
      }
      return adminApi.updateModel(model.id, payload)
    },
    onSuccess: () => {
      toast.success('已保存')
      qc.invalidateQueries({ queryKey: ['admin', 'models'] })
      qc.invalidateQueries({ queryKey: ['models'] })
      onClose()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '保存失败'),
  })

  const toggleCap = (k: keyof ModelCapabilities) => setCaps((c) => ({ ...c, [k]: !c[k] }))
  const toggleEffort = (e: ReasoningEffort) =>
    setAllowedEfforts((arr) =>
      arr.includes(e) ? arr.filter((x) => x !== e) : [...arr, e],
    )

  return (
    <Modal
      open
      onClose={onClose}
      title={`配置模型 · ${model.modelId}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            保存
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
            在用户端启用
          </label>
          <Toggle checked={enabled} onChange={setEnabled} />
        </div>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
            显示名称
          </span>
          <input
            className={fieldClass}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
            类型
          </span>
          <select
            className={fieldClass}
            value={kind}
            onChange={(e) => setKind(e.target.value as 'responses' | 'image')}
          >
            <option value="responses">对话模型（Responses）</option>
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
            placeholder="可选，作为该模型的默认 system 指令"
          />
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
      </div>
    </Modal>
  )
}
