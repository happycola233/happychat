import { clsx } from 'clsx'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Copy, GripVertical, SlidersHorizontal, Trash2 } from 'lucide-react'
import type { AdminModelDTO } from '@shared/types/api'
import type { ModelCapabilities } from '@shared/types/domain'
import { normalizeModelPricing } from '@shared/util/cost'
import { ModelIconMark, DEFAULT_MODEL_ICON_TONE_CLASS } from '../../components/ModelIcon'
import { ModelTagList } from '../../components/ModelTags'
import { Checkbox } from '../../components/ui/Checkbox'
import { IconButton } from '../../components/ui/IconButton'
import { Toggle } from '../../components/ui/Toggle'
import type { ModelEditorSection } from './ModelEditor'

/** 按列表实际宽度切换布局，兼顾侧栏展开与收起；表头和行共用列宽。 */
const MODEL_COLUMNS =
  '@min-[70rem]/models:grid-cols-[minmax(200px,1.1fr)_minmax(110px,0.55fr)_minmax(240px,0.9fr)_minmax(220px,0.75fr)_86px_44px_96px]'
const CAPABILITY_LABELS: { key: keyof ModelCapabilities; label: string }[] = [
  { key: 'vision', label: '视觉' },
  { key: 'file_input', label: '文件' },
  { key: 'web_search', label: '联网' },
  { key: 'x_search', label: 'X 搜索' },
  { key: 'artifacts', label: 'Artifacts' },
  { key: 'image_generation', label: '生图' },
]
const PROTOCOL_LABEL = {
  responses: 'Responses',
  chat: 'Chat Completions',
  anthropic: 'Messages',
  image: 'Images',
}
export function ModelListHeader() {
  return (
    <div
      className={clsx(
        'hidden items-center gap-3 rounded-t-lg bg-neutral-50 px-3 py-2.5 text-xs text-neutral-500 @min-[70rem]/models:grid dark:bg-neutral-900/60',
        MODEL_COLUMNS,
      )}
    >
      <span className="pl-7">模型 / ID</span>
      <span>供应商 / 接口</span>
      <span>能力 / 默认思考</span>
      <span>基础定价</span>
      <span>可用用户</span>
      <span>启用</span>
      <span className="text-right">操作</span>
    </div>
  )
}

export function ModelListRow({
  model,
  sortable,
  batchMode,
  selected,
  onToggleSelected,
  onEdit,
  onDuplicate,
  duplicatePending,
  onAccess,
  onToggle,
  togglePending,
  onDelete,
}: {
  model: AdminModelDTO
  sortable: boolean
  batchMode: boolean
  selected: boolean
  onToggleSelected: () => void
  onEdit: (section?: ModelEditorSection) => void
  onDuplicate: () => void
  duplicatePending: boolean
  onAccess: () => void
  onToggle: () => void
  togglePending: boolean
  onDelete: () => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: model.id, disabled: !sortable })
  const pricing = normalizeModelPricing(model.pricing, model.kind)
  const priceText = (price: number | undefined) =>
    price == null
      ? '—'
      : `${pricing.currency === 'CNY' ? '¥' : '$'}${price.toLocaleString('en-US', { maximumFractionDigits: 6 })}`
  const imagePricing = pricing.imageGeneration
  const imagePriceLabel = pricing.imagePricingModelId
    ? '生图 · 引用定价'
    : imagePricing?.mode === 'per_request'
      ? `${priceText(imagePricing.price)} / 次`
      : imagePricing?.mode === 'per_image'
        ? `${priceText(imagePricing.price)} / 张${imagePricing.tiers?.length ? ' · 分档' : ''}`
        : imagePricing
          ? `图片输出 ${priceText(imagePricing.imageOutput)} / 百万`
          : null
  const pricingDetail =
    model.kind === 'image'
      ? imagePricing?.mode === 'per_request'
        ? '按次计价'
        : imagePricing?.mode === 'per_image'
          ? '按张计价'
          : '按 Token 计价'
      : (imagePriceLabel ??
        `缓存 ${pricing.cachedInput == null ? '随输入' : priceText(pricing.cachedInput)}`)
  const pricingFeatures = [
    pricing.periods?.length ? '分时' : null,
    pricing.contextTiers?.length ||
    pricing.periods?.some((period) => period.pricing.contextTiers?.length)
      ? '分档'
      : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const accessLabel =
    model.accessMode === 'all'
      ? '全部用户'
      : model.allowedUserCount > 0
        ? `指定 ${model.allowedUserCount} 人`
        : '未选择用户'
  const enabledCapabilities = CAPABILITY_LABELS.filter(({ key }) =>
    key === 'image_generation'
      ? model.kind === 'image' || model.capabilities.image_generation
      : model.capabilities[key],
  )
  return (
    <div
      ref={setNodeRef}
      data-model-row={model.id}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onClick={batchMode ? onToggleSelected : undefined}
      className={clsx(
        'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3 py-3 text-[13px] transition @min-[70rem]/models:gap-y-0',
        MODEL_COLUMNS,
        selected
          ? 'bg-sky-50 dark:bg-sky-950/30'
          : 'hover:bg-neutral-50 dark:hover:bg-neutral-900/60',
        batchMode && 'cursor-pointer',
        isDragging && 'relative z-10 bg-white ring-1 ring-sky-300 dark:bg-neutral-900',
      )}
    >
      <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-2 @min-[70rem]/models:col-auto @min-[70rem]/models:row-auto">
        {batchMode ? (
          <span className="shrink-0" onClick={(event) => event.stopPropagation()}>
            <Checkbox
              checked={selected}
              onChange={onToggleSelected}
              ariaLabel={`选择 ${model.displayName}`}
            />
          </span>
        ) : sortable ? (
          <button
            ref={setActivatorNodeRef}
            type="button"
            aria-label={`拖动排序 ${model.displayName}`}
            className="flex h-8 w-5 shrink-0 touch-none items-center justify-center rounded cursor-grab text-neutral-300 hover:text-neutral-600 active:cursor-grabbing dark:text-neutral-600 dark:hover:text-neutral-300"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
        ) : (
          <span className="hidden w-5 shrink-0 @min-[70rem]/models:block" />
        )}
        <span className="flex shrink-0 items-center">
          <ModelIconMark
            icon={model.icon}
            modelId={model.modelId}
            displayName={model.displayName}
            size="md"
            className={DEFAULT_MODEL_ICON_TONE_CLASS}
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            {batchMode ? (
              <span className="truncate text-sm font-medium leading-5">{model.displayName}</span>
            ) : (
              <button
                type="button"
                onClick={() => onEdit()}
                title={model.displayName}
                className="block min-w-0 truncate text-left text-sm font-medium leading-5 text-neutral-900 hover:text-sky-600 dark:text-neutral-100 dark:hover:text-sky-400"
              >
                {model.displayName}
              </button>
            )}
            <span className="hidden min-w-0 overflow-hidden @min-[70rem]/models:block">
              <ModelTagList tags={model.tags} />
            </span>
          </div>
          <p
            className="truncate text-xs leading-4 text-neutral-500"
            title={`${model.modelId}${model.description ? ` · ${model.description}` : ''}`}
          >
            {model.modelId}
            <span className="@min-[70rem]/models:hidden"> · {model.providerName}</span>
          </p>
        </div>
      </div>
      <div className="hidden min-w-0 @min-[70rem]/models:block">
        <p
          className="truncate leading-5 text-neutral-700 dark:text-neutral-300"
          title={model.providerName}
        >
          {model.providerName}
        </p>
        <p className="truncate text-xs leading-4 text-neutral-500">{PROTOCOL_LABEL[model.kind]}</p>
      </div>
      <div className="col-span-2 col-start-1 row-start-2 min-w-0 space-y-1.5 @min-[40rem]/models:col-span-1 @min-[70rem]/models:col-auto @min-[70rem]/models:row-auto">
        {/* 标签整体换行，避免中文能力名在窄列中被拆成单字。 */}
        {enabledCapabilities.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {enabledCapabilities.map(({ key, label }) => (
              <span
                key={key}
                title={`${label}已开启`}
                className={clsx(
                  'inline-flex shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] leading-4',
                  key === 'image_generation'
                    ? 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300'
                    : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300',
                )}
              >
                {label}
              </span>
            ))}
          </div>
        )}
        {model.capabilities.reasoning ? (
          <p className="flex min-w-0 items-center gap-1 text-xs leading-4 text-neutral-500 dark:text-neutral-400">
            <span className="shrink-0">思考</span>
            <span
              title={model.defaultEffort ?? '未设默认'}
              className="truncate font-medium text-neutral-600 dark:text-neutral-300"
            >
              {model.defaultEffort ?? '未设默认'}
            </span>
          </p>
        ) : enabledCapabilities.length === 0 ? (
          <span className="text-xs text-neutral-500 dark:text-neutral-400">纯文本</span>
        ) : null}
      </div>
      <button
        type="button"
        disabled={batchMode}
        onClick={() => onEdit('pricing')}
        aria-label={`配置 ${model.displayName} 的定价`}
        title={[
          '编辑定价',
          pricingDetail,
          pricingFeatures,
          pricing.periods?.length ? `${pricing.periods.length} 个定价时段` : null,
          pricing.contextTiers?.length ? `${pricing.contextTiers.length} 个上下文档位` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        className="col-span-2 col-start-1 row-start-3 min-w-0 rounded text-left text-xs leading-[18px] tabular-nums hover:text-sky-600 @min-[40rem]/models:col-span-1 @min-[40rem]/models:col-start-2 @min-[40rem]/models:row-start-2 @min-[40rem]/models:text-right @min-[70rem]/models:col-auto @min-[70rem]/models:row-auto @min-[70rem]/models:text-left dark:hover:text-sky-400"
      >
        <span className="block truncate text-neutral-800 dark:text-neutral-200">
          {model.kind === 'image'
            ? imagePriceLabel
            : `${priceText(pricing.input)} / ${priceText(pricing.output)} · 百万`}
        </span>
        {/* 附加单价与定价规则共用次行，避免分档模型额外撑高列表。 */}
        <span className="flex min-w-0 items-baseline gap-1.5 text-[11px] text-neutral-500 @min-[40rem]/models:justify-end @min-[70rem]/models:justify-start">
          <span className="min-w-0 truncate">{pricingDetail}</span>
          {pricingFeatures && (
            <>
              <span aria-hidden className="shrink-0 text-neutral-400 dark:text-neutral-600">
                ·
              </span>
              <span className="shrink-0 whitespace-nowrap text-sky-600 dark:text-sky-400">
                {pricingFeatures}
              </span>
            </>
          )}
        </span>
      </button>
      <button
        type="button"
        disabled={batchMode}
        onClick={onAccess}
        aria-label={`配置 ${model.displayName} 的可用用户，当前${accessLabel}`}
        className={clsx(
          'col-start-1 row-start-4 min-h-8 truncate rounded text-left text-xs hover:text-sky-600 @min-[40rem]/models:row-start-3 @min-[70rem]/models:col-auto @min-[70rem]/models:row-auto',
          model.accessMode === 'all' ? 'text-neutral-500' : 'text-sky-700 dark:text-sky-300',
        )}
      >
        {accessLabel}
      </button>
      <div className="col-start-2 row-start-1 flex justify-end @min-[70rem]/models:col-auto @min-[70rem]/models:row-auto @min-[70rem]/models:justify-start">
        {!batchMode && (
          <Toggle
            checked={model.enabled}
            onChange={onToggle}
            disabled={togglePending}
            ariaLabel={`${model.enabled ? '全局停用' : '全局启用'} ${model.displayName}`}
          />
        )}
      </div>
      <div className="col-start-2 row-start-4 flex justify-end @min-[40rem]/models:row-start-3 @min-[70rem]/models:col-auto @min-[70rem]/models:row-auto">
        {!batchMode && (
          <>
            <IconButton
              label={`复制模型 ${model.displayName}`}
              onClick={onDuplicate}
              disabled={duplicatePending}
            >
              <Copy className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton label={`配置 ${model.displayName}`} onClick={() => onEdit()}>
              <SlidersHorizontal className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton label={`删除 ${model.displayName}`} tone="danger" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" />
            </IconButton>
          </>
        )}
      </div>
    </div>
  )
}
