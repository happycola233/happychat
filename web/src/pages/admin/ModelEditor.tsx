import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
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
import { REASONING_EFFORT_OPTION_LABELS } from '../../lib/reasoningLabels'
import { toast } from '../../store/toast'

const fieldClass =
  'w-full rounded-xl border border-neutral-300 bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100'

type EditableCapability = Exclude<keyof ModelCapabilities, 'image_generation'>

const CAP_LABELS: Record<EditableCapability, string> = {
  vision: '图片输入（视觉）',
  file_input: '文件输入',
  web_search: '联网搜索',
  reasoning: '思考（reasoning）',
}

const EDITABLE_CAP_KEYS: EditableCapability[] = ['vision', 'file_input', 'web_search', 'reasoning']

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

/** 表单分区：小标题 + 可选说明 + 内容，用分隔线区隔，让长表单有层次。 */
function FormSection({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: ReactNode
}) {
  return (
    <section className="space-y-3 py-5 first:pt-0 last:pb-0">
      <div>
        <h4 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">{title}</h4>
        {hint && <p className="mt-0.5 text-xs leading-5 text-neutral-400">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

/** 标准字段：sm 标签 + 控件。 */
function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
        {label}
      </span>
      {children}
    </label>
  )
}

/** 紧凑字段：xs 标签（参数、定价这类次级输入）。 */
function SmallField({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs text-neutral-500">{label}</span>
      {children}
    </label>
  )
}

/** 一行「标签 + 开关」控件。 */
function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-sm font-medium text-neutral-700 dark:text-neutral-300">{label}</div>
        {description && <p className="mt-1 text-xs leading-5 text-neutral-400">{description}</p>}
      </div>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  )
}

/** model 为 null 时进入「新建」模式。 */
export function ModelEditor({
  model,
  onClose,
}: {
  model: AdminModelDTO | null
  onClose: () => void
}) {
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
  const [promptCacheRetentionEnabled, setPromptCacheRetentionEnabled] = useState(
    model?.promptCacheRetentionEnabled ?? false,
  )
  const [kind, setKind] = useState(model?.kind ?? 'responses')
  const [caps, setCaps] = useState<ModelCapabilities>(model?.capabilities ?? BLANK_CAPS)
  const [systemPrompt, setSystemPrompt] = useState(model?.defaultSystemPrompt ?? '')
  const [allowedEfforts, setAllowedEfforts] = useState<ReasoningEffort[]>(
    model?.allowedEfforts ?? [],
  )
  const [defaultEffort, setDefaultEffort] = useState<ReasoningEffort | ''>(
    model?.defaultEffort ?? '',
  )
  const [defaultWebSearch, setDefaultWebSearch] = useState(model?.defaultWebSearch ?? false)
  const [params, setParams] = useState<ModelParams>(model?.defaultParams ?? {})
  const [pricing, setPricing] = useState<ModelPricing>(model?.pricing ?? {})
  const [hardParamsText, setHardParamsText] = useState(
    model?.hardParams ? JSON.stringify(model.hardParams, null, 2) : '',
  )
  const promptRef = useRef<HTMLTextAreaElement>(null)

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
      const capabilities: ModelCapabilities = { ...caps, image_generation: kind === 'image' }
      const shared = {
        displayName,
        kind,
        promptCacheRetentionEnabled: kind === 'image' ? false : promptCacheRetentionEnabled,
        capabilities,
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
        await adminApi.createModel({
          providerId,
          modelId: modelId.trim(),
          enabled,
          sort: 0,
          ...shared,
        })
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

  /** 把 {{变量}} 插入系统提示词光标处（无焦点时追加到末尾）。 */
  const insertVariable = (name: string) => {
    const token = `{{${name}}}`
    const el = promptRef.current
    const start = el?.selectionStart ?? systemPrompt.length
    const end = el?.selectionEnd ?? systemPrompt.length
    setSystemPrompt(systemPrompt.slice(0, start) + token + systemPrompt.slice(end))
    // 恢复焦点并把光标移到插入内容之后。
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      const caret = start + token.length
      el.setSelectionRange(caret, caret)
    })
  }

  const canSave =
    !isCreate || (Boolean(providerId) && modelId.trim() !== '' && displayName.trim() !== '')

  return (
    <Modal
      open
      onClose={onClose}
      title={isCreate ? '添加模型' : `配置模型 · ${model.modelId}`}
      size="form"
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
      <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
        {/* ============ 基本信息 ============ */}
        <FormSection title="基本信息">
          {isCreate && (
            <Field label="所属供应商">
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
            </Field>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="模型 ID">
              <input
                className={fieldClass}
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                placeholder="如 gpt-5.5"
              />
            </Field>
            <Field label="外显名称">
              <input
                className={fieldClass}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="如 GPT-5.5"
              />
            </Field>
          </div>

          <Field label="类型">
            <select
              className={fieldClass}
              value={kind}
              onChange={(e) => setKind(e.target.value as 'responses' | 'chat' | 'image')}
            >
              <option value="responses">对话模型（Responses API）</option>
              <option value="chat">对话模型（chat/completions）</option>
              <option value="image">图片生成模型</option>
            </select>
          </Field>

          <ToggleRow label="在用户端启用" checked={enabled} onChange={setEnabled} />
        </FormSection>

        {/* ============ 能力 ============ */}
        <FormSection title="能力">
          <div className="space-y-2.5">
            {EDITABLE_CAP_KEYS.map((k) => (
              <label key={k} className="flex items-center justify-between text-sm">
                <span className="text-neutral-600 dark:text-neutral-300">{CAP_LABELS[k]}</span>
                <Toggle checked={caps[k]} onChange={() => toggleCap(k)} />
              </label>
            ))}
          </div>

          {caps.reasoning && (
            <div className="rounded-xl bg-neutral-50 p-3 dark:bg-neutral-800/50">
              <span className="mb-2 block text-xs font-medium text-neutral-600 dark:text-neutral-300">
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
                        : 'border-neutral-300 text-neutral-500 hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-800'
                    }`}
                  >
                    {REASONING_EFFORT_OPTION_LABELS[e]}
                  </button>
                ))}
              </div>
              <SmallField label="默认思考等级">
                <select
                  className={fieldClass}
                  value={defaultEffort}
                  onChange={(e) => setDefaultEffort(e.target.value as ReasoningEffort | '')}
                >
                  <option value="">未设置</option>
                  {allowedEfforts.map((e) => (
                    <option key={e} value={e}>
                      {REASONING_EFFORT_OPTION_LABELS[e]}
                    </option>
                  ))}
                </select>
              </SmallField>
            </div>
          )}

          {caps.web_search && (
            <ToggleRow
              label="默认开启联网搜索"
              checked={defaultWebSearch}
              onChange={setDefaultWebSearch}
            />
          )}
        </FormSection>

        {/* ============ 缓存策略 ============ */}
        <FormSection title="缓存策略">
          <ToggleRow
            label="应用提供商的缓存保留策略"
            description={
              kind === 'image'
                ? 'Images API 没有定义 prompt_cache_key 或 prompt_cache_retention。'
                : '开启后发送所属提供商配置的 prompt_cache_retention；稳定 prompt_cache_key 不受此开关影响。'
            }
            checked={kind !== 'image' && promptCacheRetentionEnabled}
            onChange={setPromptCacheRetentionEnabled}
            disabled={kind === 'image'}
          />
        </FormSection>

        {/* ============ 默认系统提示词 ============ */}
        <FormSection
          title="默认系统提示词"
          hint="可选，作为该模型的默认 system 指令；支持下方变量。"
        >
          <textarea
            ref={promptRef}
            className={`${fieldClass} min-h-[168px] resize-y leading-6`}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="例如：你是 {{model_name}}，当前用户是 {{current_user}}，今天是 {{current_date}}……"
          />
          <div className="rounded-xl bg-neutral-50 p-3 dark:bg-neutral-800/50">
            <div className="mb-2 text-xs text-neutral-500">
              可用变量（点击插入到光标处，请求时按当前用户、模型或时间自动替换）：
            </div>
            <div className="grid grid-cols-1 gap-y-0.5">
              {PROMPT_VARIABLES.map((v) => (
                <button
                  key={v.name}
                  type="button"
                  onClick={() => insertVariable(v.name)}
                  className="grid grid-cols-[9rem_1fr] items-baseline gap-x-3 rounded-md px-1.5 py-1 text-left transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  <code className="justify-self-start rounded bg-neutral-200/70 px-1 font-mono text-[11px] text-neutral-700 dark:bg-neutral-700/60 dark:text-neutral-200">
                    {`{{${v.name}}}`}
                  </code>
                  <span
                    className={`text-xs leading-5 ${v.cacheVolatile ? 'text-amber-600 dark:text-amber-400' : 'text-neutral-500 dark:text-neutral-400'}`}
                  >
                    {v.description}
                    {v.cacheVolatile ? '；动态值会降低缓存命中率' : ''}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </FormSection>

        {/* ============ 默认参数（仅 responses） ============ */}
        {kind === 'responses' && (
          <FormSection title="默认参数" hint="用户未覆盖时使用；留空表示交给上游默认。">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <SmallField label="temperature">
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
              </SmallField>
              <SmallField label="top_p">
                <input
                  className={fieldClass}
                  type="number"
                  step="0.05"
                  value={params.top_p ?? ''}
                  onChange={(e) => setParams((p) => ({ ...p, top_p: numOrUndef(e.target.value) }))}
                  placeholder="默认"
                />
              </SmallField>
              <SmallField label="verbosity">
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
              </SmallField>
              <SmallField label="max_output_tokens">
                <input
                  className={fieldClass}
                  type="number"
                  value={params.max_output_tokens ?? ''}
                  onChange={(e) =>
                    setParams((p) => ({ ...p, max_output_tokens: numOrUndef(e.target.value) }))
                  }
                  placeholder="默认"
                />
              </SmallField>
            </div>
          </FormSection>
        )}

        {/* ============ 定价 ============ */}
        <FormSection title="定价" hint="USD / 每 100 万 tokens，用于成本估算；留空的项不计入成本。">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SmallField label="输入 input">
              <input
                className={fieldClass}
                type="number"
                step="0.01"
                min="0"
                value={pricing.input ?? ''}
                onChange={(e) => setPricing((p) => ({ ...p, input: numOrUndef(e.target.value) }))}
                placeholder="未设置"
              />
            </SmallField>
            <SmallField label="缓存输入 cached">
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
            </SmallField>
            <SmallField label="输出 output">
              <input
                className={fieldClass}
                type="number"
                step="0.01"
                min="0"
                value={pricing.output ?? ''}
                onChange={(e) => setPricing((p) => ({ ...p, output: numOrUndef(e.target.value) }))}
                placeholder="未设置"
              />
            </SmallField>
            <SmallField label="图片 image">
              <input
                className={fieldClass}
                type="number"
                step="0.01"
                min="0"
                value={pricing.image ?? ''}
                onChange={(e) => setPricing((p) => ({ ...p, image: numOrUndef(e.target.value) }))}
                placeholder="未设置"
              />
            </SmallField>
          </div>
        </FormSection>

        {/* ============ 高级 ============ */}
        <FormSection title="高级">
          <Field label="请求体硬参数（JSON）">
            <textarea
              className={`${fieldClass} min-h-[168px] resize-y font-mono text-xs`}
              value={hardParamsText}
              onChange={(e) => setHardParamsText(e.target.value)}
              placeholder={'例如 {"reasoning":{"summary":"auto"}}'}
              spellCheck={false}
            />
          </Field>
          <p className="text-xs leading-5 text-neutral-400">
            会按「硬参数 &gt; 用户参数 &gt; 模型默认」深度合并进上游请求体，完全可控（如
            summary、store、include 等）。留空表示无。
          </p>
        </FormSection>
      </div>
    </Modal>
  )
}
