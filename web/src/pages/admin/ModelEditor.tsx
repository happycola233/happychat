import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PROMPT_VARIABLES } from '@shared/util/promptTemplate'
import {
  anthropicDefaultMaxOutputTokens,
  anthropicDefaultReasoningEffort,
  anthropicDefaultHardParamsText,
  hasAnthropicThinkingBudgetConflict,
  anthropicModelProfile,
  anthropicReasoningEffortOptions,
} from '@shared/util/anthropic'
import type { AdminModelDTO } from '@shared/types/api'
import type {
  ModelCapabilities,
  ModelIcon,
  ModelKind,
  ModelParams,
  ModelPricing,
  ModelTag,
} from '@shared/types/domain'
import { guessModelIconSlug } from '@shared/util/modelIconGuess'
import * as adminApi from '../../api/admin'
import { IconPicker } from '../../components/IconPicker'
import { DEFAULT_MODEL_ICON_TONE_CLASS, ModelIconMark } from '../../components/ModelIcon'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Toggle } from '../../components/ui/Toggle'
import { toast } from '../../store/toast'
import { ReasoningEffortEditor } from './ReasoningEffortEditor'
import {
  createManualModelReasoningEffortDrafts,
  createReasoningEffortDraft,
  validateReasoningEffortDrafts,
} from './reasoningEffortDrafts'
import { Field, SmallField } from './FormField'
import {
  migrateDefaultParamsFromAnthropic,
  migrateDefaultParamsToAnthropic,
  migrateHardParamsFromAnthropic,
  migrateHardParamsToAnthropic,
  modelKindForProviderProtocol,
} from './modelProtocolMigration'
import { TagsInput } from './TagsInput'

const fieldClass =
  'w-full rounded-xl border border-neutral-300 bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100'

/** 紧凑输入：参数/定价这类短数值多列排布用，避免一屏全是大输入框。 */
const compactFieldClass =
  'w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-sm tabular-nums outline-none transition placeholder:text-neutral-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100'

const MODEL_INPUT_EXAMPLES: Record<ModelKind, { modelId: string; displayName: string }> = {
  responses: { modelId: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol' },
  chat: { modelId: 'deepseek-v4-pro', displayName: 'DeepSeek-V4-Pro' },
  anthropic: { modelId: 'claude-sonnet-5', displayName: 'Claude Sonnet 5' },
  image: { modelId: 'gpt-image-1', displayName: 'GPT Image 1' },
}

type EditableCapability = Exclude<keyof ModelCapabilities, 'image_generation'>

const CAP_LABELS: Record<EditableCapability, string> = {
  vision: '图片输入（视觉）',
  file_input: '文件输入',
  web_search: '联网搜索',
  x_search: 'X 搜索（xAI）',
  reasoning: '思考（reasoning）',
}

const EDITABLE_CAP_KEYS: EditableCapability[] = [
  'vision',
  'file_input',
  'web_search',
  'x_search',
  'reasoning',
]

const BLANK_CAPS: ModelCapabilities = {
  vision: false,
  file_input: false,
  web_search: false,
  x_search: false,
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

/** 一行「标签 + 开关」控件。 */
function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string
  description?: ReactNode
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

  // 分组下拉在新建和编辑时都要用（编辑时也允许直接改归属）。
  const { data: modelGroups } = useQuery({
    queryKey: ['admin', 'model-groups'],
    queryFn: adminApi.listAdminModelGroups,
  })

  const [providerId, setProviderId] = useState(model?.providerId ?? '')
  const [modelId, setModelId] = useState(model?.modelId ?? '')
  const [displayName, setDisplayName] = useState(model?.displayName ?? '')
  const [description, setDescription] = useState(model?.description ?? '')
  const [tags, setTags] = useState<ModelTag[]>(model?.tags ?? [])
  const [icon, setIcon] = useState<ModelIcon | null>(model?.icon ?? null)
  const [groupId, setGroupId] = useState(model?.groupId ?? '')
  // 未显式设置图标时，用户端会按模型 ID 自动识别品牌图标；这里把结果预告给管理员。
  const hasModelIdentity = Boolean(displayName.trim() || modelId.trim())
  const autoIconSlug = guessModelIconSlug(modelId, displayName)
  const [kind, setKind] = useState(model?.kind ?? 'responses')
  const [caps, setCaps] = useState<ModelCapabilities>(model?.capabilities ?? BLANK_CAPS)
  const [systemPrompt, setSystemPrompt] = useState(model?.defaultSystemPrompt ?? '')
  const [reasoningEffortDrafts, setReasoningEffortDrafts] = useState(() =>
    model
      ? model.allowedEfforts.map((option) => createReasoningEffortDraft(option))
      : createManualModelReasoningEffortDrafts(),
  )
  // 绑定稳定的表单行 id，编辑上游 value 的过程中默认项不会意外丢失或指向别行。
  const [defaultEffortDraftId, setDefaultEffortDraftId] = useState<string | null>(() => {
    if (!model?.defaultEffort) return null
    return (
      reasoningEffortDrafts.find((draft) => draft.value === model.defaultEffort)?.draftId ?? null
    )
  })
  const [defaultWebSearch, setDefaultWebSearch] = useState(model?.defaultWebSearch ?? false)
  const [defaultXSearch, setDefaultXSearch] = useState(model?.defaultXSearch ?? false)
  const [replayProviderContext, setReplayProviderContext] = useState(
    model?.replayProviderContext ?? false,
  )
  const [params, setParams] = useState<ModelParams>(model?.defaultParams ?? {})
  const [pricing, setPricing] = useState<ModelPricing>(model?.pricing ?? {})
  const initialHardParamsText = model?.hardParams ? JSON.stringify(model.hardParams, null, 2) : ''
  const [hardParamsText, setHardParamsText] = useState(initialHardParamsText)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  // 只自动迁移仍与系统预设完全一致的 JSON；管理员一旦编辑，就视为自主管理请求体。
  const managedAnthropicHardParamsPresetRef = useRef<string | null>(
    model?.kind === 'anthropic' &&
      initialHardParamsText.trim() === anthropicDefaultHardParamsText(model.modelId).trim()
      ? initialHardParamsText
      : null,
  )
  const autoFilledAnthropicMaxOutputTokensRef = useRef(false)
  const lastAppliedAnthropicModelIdRef = useRef(
    model?.kind === 'anthropic' ? model.modelId.trim() : '',
  )
  const selectedProviderProtocol = model
    ? model.kind === 'anthropic'
      ? 'anthropic'
      : 'openai'
    : providers?.find((provider) => provider.id === providerId)?.protocol
  const modelInputExample = selectedProviderProtocol ? MODEL_INPUT_EXAMPLES[kind] : null
  const activeAnthropicProfile =
    kind === 'anthropic'
      ? anthropicModelProfile(modelId.trim() || MODEL_INPUT_EXAMPLES.anthropic.modelId)
      : null

  const applyAnthropicPreset = (targetModelId: string, migrateExisting: boolean) => {
    const presetModelId = targetModelId || MODEL_INPUT_EXAMPLES.anthropic.modelId
    lastAppliedAnthropicModelIdRef.current = presetModelId
    const profile = anthropicModelProfile(presetModelId)
    const effortDrafts = anthropicReasoningEffortOptions(profile).map((option) =>
      createReasoningEffortDraft(option),
    )
    setReasoningEffortDrafts(effortDrafts)
    const defaultEffortValue = anthropicDefaultReasoningEffort(profile)
    const defaultEffort = effortDrafts.find((draft) => draft.value === defaultEffortValue)
    setDefaultEffortDraftId(defaultEffort?.draftId ?? null)
    setCaps((current) => ({
      ...current,
      vision: true,
      file_input: true,
      web_search: true,
      x_search: false,
      reasoning: profile.preferredThinkingType !== null,
    }))
    setReplayProviderContext(true)
    const defaultParamsMigration = migrateDefaultParamsToAnthropic(
      params,
      anthropicDefaultMaxOutputTokens(),
    )
    if (defaultParamsMigration.autoFilledMaxOutputTokens) {
      autoFilledAnthropicMaxOutputTokensRef.current = true
    }
    setParams(defaultParamsMigration.params)
    const preset = anthropicDefaultHardParamsText(presetModelId)
    const presetWasManaged = managedAnthropicHardParamsPresetRef.current !== null
    setHardParamsText((current) => {
      const next = migrateExisting
        ? migrateHardParamsToAnthropic(current, presetModelId)
        : presetWasManaged
          ? preset
          : current
      managedAnthropicHardParamsPresetRef.current = next.trim() === preset.trim() ? preset : null
      return next
    })
  }

  const changeKind = (nextKind: ModelKind) => {
    if (kind === 'anthropic' && nextKind !== 'anthropic') {
      managedAnthropicHardParamsPresetRef.current = null
      const removeAutoFilledMaxOutputTokens = autoFilledAnthropicMaxOutputTokensRef.current
      autoFilledAnthropicMaxOutputTokensRef.current = false
      setParams((current) =>
        migrateDefaultParamsFromAnthropic(current, removeAutoFilledMaxOutputTokens),
      )
      setHardParamsText((current) => migrateHardParamsFromAnthropic(current, nextKind))
      setReasoningEffortDrafts(createManualModelReasoningEffortDrafts())
      setDefaultEffortDraftId(null)
    }
    setKind(nextKind)
    if (nextKind === 'anthropic') applyAnthropicPreset(modelId.trim(), true)
  }

  const changeProvider = (nextProviderId: string) => {
    setProviderId(nextProviderId)
    const selectedProvider = providers?.find((provider) => provider.id === nextProviderId)
    if (!selectedProvider) return
    const nextKind = modelKindForProviderProtocol(kind, selectedProvider.protocol)
    if (nextKind !== kind) changeKind(nextKind)
  }

  const cleanedPricing = (): ModelPricing | null => {
    const p: ModelPricing = {}
    if (pricing.input != null) p.input = pricing.input
    if (pricing.cacheWriteInput != null) p.cacheWriteInput = pricing.cacheWriteInput
    if (pricing.cachedInput != null) p.cachedInput = pricing.cachedInput
    if (pricing.output != null) p.output = pricing.output
    if (pricing.image != null) p.image = pricing.image
    return Object.keys(p).length ? p : null
  }

  const parseHardParams = (text = hardParamsText): Record<string, unknown> | null => {
    const t = text.trim()
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
      const reasoningEffortError = validateReasoningEffortDrafts(reasoningEffortDrafts)
      if (reasoningEffortError) throw new Error(reasoningEffortError)
      const defaultEffort = defaultEffortDraftId
        ? reasoningEffortDrafts
            .find((draft) => draft.draftId === defaultEffortDraftId)
            ?.value.trim()
        : null
      if (defaultEffortDraftId && !defaultEffort) throw new Error('请选择有效的默认思考等级')
      const hardParams = parseHardParams()
      if (
        kind === 'anthropic' &&
        (!Number.isInteger(params.max_output_tokens) || (params.max_output_tokens ?? 0) <= 0)
      ) {
        throw new Error('Anthropic Messages API 必须配置正整数 max_output_tokens')
      }
      if (
        kind === 'anthropic' &&
        hasAnthropicThinkingBudgetConflict(
          hardParams?.max_tokens ?? params.max_output_tokens,
          hardParams?.thinking,
        )
      ) {
        throw new Error('Anthropic thinking.budget_tokens 必须小于最终 max_tokens')
      }

      const capabilities: ModelCapabilities = {
        ...caps,
        x_search: kind === 'anthropic' ? false : caps.x_search,
        image_generation: kind === 'image',
      }
      const shared = {
        displayName,
        description: description.trim() || null,
        tags,
        icon,
        groupId: groupId || null,
        kind,
        capabilities,
        defaultSystemPrompt: systemPrompt.trim() ? systemPrompt : null,
        // 能力开关只控制运行时是否使用推理；暂时关闭时保留管理员配置，避免静默丢数据。
        allowedEfforts: reasoningEffortDrafts.map((draft) => ({
          value: draft.value.trim(),
          description: draft.description.trim(),
        })),
        defaultEffort: defaultEffort || null,
        replayProviderContext,
        defaultWebSearch: caps.web_search ? defaultWebSearch : false,
        defaultXSearch: capabilities.x_search ? defaultXSearch : false,
        defaultParams: {
          temperature: params.temperature,
          top_p: params.top_p,
          verbosity: params.verbosity,
          max_output_tokens: params.max_output_tokens,
        },
        pricing: cleanedPricing(),
        hardParams,
      }
      if (isCreate) {
        await adminApi.createModel({
          providerId,
          modelId: modelId.trim(),
          // 全局上下架只有模型列表一个入口；新建模型默认直接启用。
          enabled: true,
          sort: 0,
          ...shared,
        })
      } else {
        // 不回传 enabled，避免打开已久的配置表单覆盖列表中的最新开关状态。
        await adminApi.updateModel(model.id, { modelId: modelId.trim(), ...shared })
      }
    },
    onSuccess: () => {
      toast.success(isCreate ? '已添加模型' : '已保存')
      qc.invalidateQueries({ queryKey: ['admin', 'models'] })
      if (isCreate || groupId !== (model?.groupId ?? '')) {
        qc.invalidateQueries({ queryKey: ['admin', 'model-groups'] })
      }
      qc.invalidateQueries({ queryKey: ['models'] })
      onClose()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '保存失败'),
  })

  const toggleCap = (k: keyof ModelCapabilities) => {
    const enabled = !caps[k]
    if (
      kind === 'anthropic' &&
      k === 'reasoning' &&
      !enabled &&
      !activeAnthropicProfile?.canDisableThinking
    ) {
      return
    }
    setCaps((current) => ({ ...current, [k]: enabled }))
  }

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

  const effortValidationError = validateReasoningEffortDrafts(reasoningEffortDrafts)
  const hasValidDefault =
    !defaultEffortDraftId ||
    reasoningEffortDrafts.some(
      (draft) => draft.draftId === defaultEffortDraftId && Boolean(draft.value.trim()),
    )
  const canSave =
    (!isCreate || Boolean(providerId)) &&
    modelId.trim() !== '' &&
    displayName.trim() !== '' &&
    !effortValidationError &&
    hasValidDefault

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
                onChange={(e) => changeProvider(e.target.value)}
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
                onBlur={() => {
                  if (kind !== 'anthropic') return
                  const targetModelId = modelId.trim() || MODEL_INPUT_EXAMPLES.anthropic.modelId
                  if (targetModelId === lastAppliedAnthropicModelIdRef.current) return
                  applyAnthropicPreset(targetModelId, false)
                }}
                placeholder={modelInputExample?.modelId ?? '请先选择供应商'}
              />
            </Field>
            <Field label="外显名称">
              <input
                className={fieldClass}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={modelInputExample?.displayName ?? '请先选择供应商'}
              />
            </Field>
          </div>

          {selectedProviderProtocol === 'openai' && (
            <Field label="类型">
              <select
                className={fieldClass}
                value={kind}
                onChange={(e) => changeKind(e.target.value as ModelKind)}
              >
                <option value="responses">对话模型（Responses API）</option>
                <option value="chat">对话模型（chat/completions）</option>
                <option value="image">生图模型（/images/generations）</option>
              </select>
            </Field>
          )}

          {selectedProviderProtocol === 'anthropic' && (
            <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-3.5 py-3 dark:border-neutral-700 dark:bg-neutral-800/60">
              <p className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
                Anthropic Messages API
              </p>
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                模型类型由供应商协议自动确定，请求发送至{' '}
                <code className="font-mono">/v1/messages</code>。
              </p>
            </div>
          )}

          <Field label="模型描述（可选）">
            <textarea
              className={`${fieldClass} min-h-[72px] resize-y leading-6`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              placeholder="用户在模型选择器中点击 ⓘ 可查看，例如：适合复杂推理与长文写作"
            />
          </Field>

          <TagsInput tags={tags} onChange={setTags} />

          <IconPicker
            value={icon}
            onChange={setIcon}
            emptyState={{
              preview: hasModelIdentity ? (
                <ModelIconMark
                  icon={null}
                  modelId={modelId}
                  displayName={displayName}
                  size="md"
                  className={DEFAULT_MODEL_ICON_TONE_CLASS}
                />
              ) : undefined,
              title: !hasModelIdentity
                ? '尚未生成图标预览'
                : autoIconSlug
                  ? '自动识别品牌图标'
                  : '名称首字母',
              description: !hasModelIdentity
                ? '填写模型 ID 或外显名称后自动识别，也可以直接手动选择'
                : autoIconSlug
                  ? `未显式设置 · ${autoIconSlug}`
                  : '未识别到品牌，当前使用模型名称首字母',
            }}
            initialOption={{
              preview: hasModelIdentity ? (
                <ModelIconMark
                  icon={{ type: 'initial' }}
                  modelId={modelId}
                  displayName={displayName}
                  size="md"
                />
              ) : null,
              available: hasModelIdentity,
              showDefaultShortcut: Boolean(autoIconSlug),
            }}
          />

          <Field label="所属分组（可选）">
            <select
              className={fieldClass}
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
            >
              <option value="">未分组</option>
              {modelGroups?.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </Field>
        </FormSection>

        {/* ============ 能力 ============ */}
        <FormSection title="能力">
          {/* 两列开关：四项能力收进两行，缩短长表单。 */}
          <div className="grid grid-cols-1 gap-x-8 gap-y-2.5 sm:grid-cols-2">
            {EDITABLE_CAP_KEYS.filter((k) => kind !== 'anthropic' || k !== 'x_search').map((k) => (
              <label key={k} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-neutral-600 dark:text-neutral-300">{CAP_LABELS[k]}</span>
                <Toggle
                  checked={caps[k]}
                  onChange={() => toggleCap(k)}
                  disabled={
                    kind === 'anthropic' &&
                    k === 'reasoning' &&
                    caps.reasoning &&
                    !activeAnthropicProfile?.canDisableThinking
                  }
                />
              </label>
            ))}
          </div>

          {caps.reasoning && (
            <ReasoningEffortEditor
              drafts={reasoningEffortDrafts}
              defaultDraftId={defaultEffortDraftId}
              onDraftsChange={setReasoningEffortDrafts}
              onDefaultDraftIdChange={setDefaultEffortDraftId}
            />
          )}

          {(kind === 'anthropic' || (kind === 'responses' && caps.reasoning)) && (
            <div className="border-t border-neutral-100 pt-3 dark:border-neutral-800">
              <ToggleRow
                label="回传提供商私有上下文"
                description={
                  kind === 'anthropic' ? (
                    <>
                      开启后，服务端会私密保存并原样回传完整 assistant blocks（含 thinking
                      签名、redacted_thinking、搜索密文与引用索引）；这些字段不会发送到浏览器或分享快照。联网搜索也依赖这些上下文，而不只是在思考开启时使用。
                      <br />
                      开启该选项有助于保持多轮思考与搜索连续并提高缓存命中；关闭后普通对话仍可继续，但后续可能丢失旧搜索上下文、重复搜索。
                    </>
                  ) : (
                    '开启后，思考模型的加密推理上下文（encrypted_content）将随对话历史回传上游，可提升多轮推理连贯性与缓存命中，但会增大请求体与输入 token。'
                  )
                }
                checked={replayProviderContext}
                onChange={setReplayProviderContext}
              />
            </div>
          )}

          {caps.web_search && (
            <ToggleRow
              label="默认开启联网搜索"
              checked={defaultWebSearch}
              onChange={setDefaultWebSearch}
            />
          )}

          {kind !== 'anthropic' && caps.x_search && (
            <ToggleRow
              label="默认开启 X 搜索"
              description="xAI Grok 专有的 X（原 Twitter）站内检索工具，与联网搜索相互独立、可同时开启。"
              checked={defaultXSearch}
              onChange={setDefaultXSearch}
            />
          )}
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

        {/* ============ 文本模型默认参数 ============ */}
        {(kind === 'responses' || kind === 'anthropic') && (
          <FormSection
            title="默认参数"
            hint={
              kind === 'anthropic'
                ? 'max_output_tokens 为必填项，发送时映射为 max_tokens；预设 16000，取自 Anthropic thinking 指南的宽裕示例值。'
                : '用户未覆盖时使用；留空表示交给上游默认。'
            }
          >
            <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 sm:grid-cols-4">
              <SmallField label="temperature">
                <input
                  className={compactFieldClass}
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
                  className={compactFieldClass}
                  type="number"
                  step="0.05"
                  value={params.top_p ?? ''}
                  onChange={(e) => setParams((p) => ({ ...p, top_p: numOrUndef(e.target.value) }))}
                  placeholder="默认"
                />
              </SmallField>
              {kind === 'responses' && (
                <SmallField label="verbosity">
                  <select
                    className={compactFieldClass}
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
              )}
              <SmallField
                label={
                  kind === 'anthropic' ? (
                    <span className="whitespace-nowrap">
                      max_output_tokens{' '}
                      <span className="text-rose-500 dark:text-rose-400" aria-hidden="true">
                        *
                      </span>
                      <span className="sr-only">（必填）</span>
                    </span>
                  ) : (
                    'max_output_tokens'
                  )
                }
              >
                <input
                  className={compactFieldClass}
                  type="number"
                  min={1}
                  step={1}
                  required={kind === 'anthropic'}
                  value={params.max_output_tokens ?? ''}
                  onChange={(e) => {
                    autoFilledAnthropicMaxOutputTokensRef.current = false
                    setParams((p) => ({ ...p, max_output_tokens: numOrUndef(e.target.value) }))
                  }}
                  placeholder={kind === 'anthropic' ? '16000' : '默认'}
                />
              </SmallField>
            </div>
          </FormSection>
        )}

        {/* ============ 定价 ============ */}
        <FormSection
          title="定价"
          hint="USD / 每 100 万 tokens，用于成本估算；缓存写入、读取均是总输入的子项，其价格留空时回退到普通输入价；其他价格留空不计。"
        >
          <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 sm:grid-cols-3">
            {(
              [
                ['input', '普通输入 input'],
                ['output', '输出 output'],
                ['cachedInput', '缓存读取/输入 cache read/input'],
                ['cacheWriteInput', '缓存写入 cache write'],
                ['image', '图片 image'],
              ] as const
            ).map(([key, label]) => (
              <SmallField key={key} label={label}>
                <input
                  className={compactFieldClass}
                  type="number"
                  step="any"
                  min="0"
                  value={pricing[key] ?? ''}
                  onChange={(e) => setPricing((p) => ({ ...p, [key]: numOrUndef(e.target.value) }))}
                  placeholder="未设置"
                />
              </SmallField>
            ))}
          </div>
        </FormSection>

        {/* ============ 高级 ============ */}
        <FormSection title="高级">
          <Field label="请求体硬参数（JSON）">
            <textarea
              className={`${fieldClass} min-h-[168px] resize-y font-mono text-xs`}
              value={hardParamsText}
              onChange={(e) => {
                managedAnthropicHardParamsPresetRef.current = null
                setHardParamsText(e.target.value)
              }}
              placeholder={
                kind === 'anthropic'
                  ? '例如 {"thinking":{"type":"adaptive"}}'
                  : '例如 {"reasoning":{"summary":"auto"}}'
              }
              spellCheck={false}
            />
          </Field>
          <p className="text-xs leading-5 text-neutral-400">
            会按「硬参数 &gt; 用户参数 &gt; 模型默认」深度合并进上游请求体，完全可控（如
            summary、store、include 等）。留空表示无。
          </p>
          {kind === 'anthropic' && (
            <div className="space-y-1 text-xs leading-5 text-neutral-400">
              <p>
                必填的 <code className="font-mono">max_tokens</code> 由上方{' '}
                <code className="font-mono">max_output_tokens</code>{' '}
                生成；只有需要管理员硬覆盖时才在这里显式填写{' '}
                <code className="font-mono">max_tokens</code>。
              </p>
              <p>
                顶层 <code className="font-mono">cache_control: ephemeral</code>{' '}
                启用官方自动提示缓存，默认有效期 5
                分钟；首次写入产生缓存写入费用，命中后可降低延迟与输入成本。
              </p>
              <p>
                <code className="font-mono">thinking.type</code> 的默认模板会按模型 ID
                自动选择：支持时优先使用 <code className="font-mono">adaptive</code>
                ，仅支持手动扩展思考的型号使用{' '}
                <code className="font-mono">enabled + budget_tokens</code>。
              </p>
              <p>
                <code className="font-mono">thinking.display: summarized</code> 是公开 API
                最详细的可见推理摘要，摘要生成本身不额外计费，并且只在思考开启时下发。
              </p>
            </div>
          )}
          {kind === 'anthropic' ? (
            <p className="text-xs leading-5 text-neutral-400">
              <code className="font-mono">tools</code> 中的原生联网模板必须显式包含官方带版本的
              type（默认 <code className="font-mono">web_search_20250305</code>）与{' '}
              <code className="font-mono">name: web_search</code>。联网开关只决定是否保留这条模板；
              删除模板后，即使打开联网也不会暗中补回。日期后缀是官方固定的工具协议版本，不是失效日期；默认不设置{' '}
              <code className="font-mono">max_uses</code>
              ，不人为限制单次搜索次数。其他自定义工具原样保留。
            </p>
          ) : (
            <p className="text-xs leading-5 text-neutral-400">
              <code className="font-mono">tools</code> 里的{' '}
              <code className="font-mono">web_search</code> /{' '}
              <code className="font-mono">x_search</code>{' '}
              只作为参数模板：开关开启时与生成的工具合并（如{' '}
              <code className="break-all font-mono">
                {'{"tools":[{"type":"web_search","enable_image_search":false}]}'}
              </code>
              ），关闭时整条丢弃，不会反过来把工具塞进请求。其他工具仍可在这里直接追加。
            </p>
          )}
        </FormSection>
      </div>
    </Modal>
  )
}
