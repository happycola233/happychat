import { clsx } from 'clsx'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Copy, GripVertical, SlidersHorizontal, Trash2 } from 'lucide-react'
import type { AdminModelDTO } from '@shared/types/api'
import type { ModelCapabilities } from '@shared/types/domain'
import { ModelIconMark, DEFAULT_MODEL_ICON_TONE_CLASS } from '../../components/ModelIcon'
import { ModelTagList } from '../../components/ModelTags'
import { Checkbox } from '../../components/ui/Checkbox'
import { IconButton } from '../../components/ui/IconButton'
import { Toggle } from '../../components/ui/Toggle'
import type { ModelEditorSection } from './ModelEditor'

/** 同一列模板用于表头与数据行；窄屏按阅读顺序重排，避免缩成横向宽表。 */
const MODEL_COLUMNS =
  'xl:grid-cols-[minmax(200px,1.5fr)_minmax(105px,0.8fr)_152px_120px_94px_48px_96px]'
const CAPABILITIES: { key: keyof ModelCapabilities; label: string }[] = [
  { key: 'vision', label: '视觉' },
  { key: 'file_input', label: '文件' },
  { key: 'web_search', label: '联网' },
  { key: 'reasoning', label: '思考' },
]
const PROTOCOL_LABEL = {
  responses: 'Responses',
  chat: 'Chat Completions',
  anthropic: 'Messages',
  image: 'Images',
}
const priceText = (price: number | undefined) =>
  price == null ? '—' : `$${price.toLocaleString('en-US', { maximumFractionDigits: 6 })}`

export function ModelListHeader() {
  return (
    <div
      className={clsx(
        'hidden items-center gap-3 rounded-t-lg bg-neutral-50 px-3 py-2.5 text-xs text-neutral-500 xl:grid dark:bg-neutral-900/60',
        MODEL_COLUMNS,
      )}
    >
      <span className="pl-7">模型 / ID</span>
      <span>供应商 / 接口</span>
      <span>能力 / 默认思考</span>
      <span title="美元 / 每 100 万 Token">输入 / 输出 · $ / 百万</span>
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
  const accessLabel =
    model.accessMode === 'all'
      ? '全部用户'
      : model.allowedUserCount > 0
        ? `指定 ${model.allowedUserCount} 人`
        : '未选择用户'
  return (
    <div
      ref={setNodeRef}
      data-model-row={model.id}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onClick={batchMode ? onToggleSelected : undefined}
      className={clsx(
        'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3 py-3 text-[13px] transition xl:gap-y-0',
        MODEL_COLUMNS,
        selected
          ? 'bg-sky-50 dark:bg-sky-950/30'
          : 'hover:bg-neutral-50 dark:hover:bg-neutral-900/60',
        batchMode && 'cursor-pointer',
        isDragging && 'relative z-10 bg-white ring-1 ring-sky-300 dark:bg-neutral-900',
      )}
    >
      <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-2 xl:col-auto xl:row-auto">
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
          <span className="hidden w-5 shrink-0 xl:block" />
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
            <span className="hidden min-w-0 overflow-hidden xl:block">
              <ModelTagList tags={model.tags} />
            </span>
          </div>
          <p
            className="truncate text-xs leading-4 text-neutral-500"
            title={`${model.modelId}${model.description ? ` · ${model.description}` : ''}`}
          >
            {model.modelId}
            <span className="xl:hidden"> · {model.providerName}</span>
          </p>
        </div>
      </div>
      <div className="hidden min-w-0 xl:block">
        <p
          className="truncate leading-5 text-neutral-700 dark:text-neutral-300"
          title={model.providerName}
        >
          {model.providerName}
        </p>
        <p className="truncate text-xs leading-4 text-neutral-500">{PROTOCOL_LABEL[model.kind]}</p>
      </div>
      <div className="col-start-1 row-start-2 min-w-0 xl:col-auto xl:row-auto">
        <div className="flex items-center gap-1.5">
          {CAPABILITIES.map(({ key, label }) => (
            <span
              key={key}
              title={`${label}：${model.capabilities[key] ? '已开启' : '未开启'}`}
              className={clsx(
                'text-xs leading-5',
                model.capabilities[key]
                  ? 'text-neutral-600 dark:text-neutral-300'
                  : 'text-neutral-300 dark:text-neutral-700',
              )}
            >
              {label}
            </span>
          ))}
          {model.capabilities.x_search && (
            <span title="X 搜索已开启" className="text-xs leading-5 text-sky-600 dark:text-sky-400">
              X
            </span>
          )}
          {model.kind === 'image' && (
            <span className="text-xs leading-5 text-sky-600 dark:text-sky-400">生图</span>
          )}
        </div>
        <p className="hidden truncate text-xs leading-4 text-neutral-500 xl:block">
          {model.capabilities.reasoning
            ? `思考 ${model.defaultEffort ?? '未设默认'}`
            : '不启用思考'}
        </p>
      </div>
      <button
        type="button"
        disabled={batchMode}
        onClick={() => onEdit('pricing')}
        aria-label={`配置 ${model.displayName} 的定价`}
        className="col-start-2 row-start-2 min-w-0 rounded text-right text-xs leading-[18px] tabular-nums hover:text-sky-600 xl:col-auto xl:row-auto xl:text-left dark:hover:text-sky-400"
        title="编辑定价 · USD / 每 100 万 Token"
      >
        <span className="block truncate text-neutral-800 dark:text-neutral-200">
          {priceText(model.pricing?.input)} / {priceText(model.pricing?.output)}
        </span>
        <span className="hidden truncate text-neutral-500 xl:block">
          缓存{' '}
          {model.pricing?.cachedInput == null ? '随输入' : priceText(model.pricing.cachedInput)}
        </span>
      </button>
      <button
        type="button"
        disabled={batchMode}
        onClick={onAccess}
        aria-label={`配置 ${model.displayName} 的可用用户，当前${accessLabel}`}
        className={clsx(
          'col-start-1 row-start-3 min-h-8 truncate rounded text-left text-xs hover:text-sky-600 xl:col-auto xl:row-auto',
          model.accessMode === 'all' ? 'text-neutral-500' : 'text-sky-700 dark:text-sky-300',
        )}
      >
        {accessLabel}
      </button>
      <div className="col-start-2 row-start-1 flex justify-end xl:col-auto xl:row-auto xl:justify-start">
        {!batchMode && (
          <Toggle
            checked={model.enabled}
            onChange={onToggle}
            disabled={togglePending}
            ariaLabel={`${model.enabled ? '全局停用' : '全局启用'} ${model.displayName}`}
          />
        )}
      </div>
      <div className="col-start-2 row-start-3 flex justify-end xl:col-auto xl:row-auto">
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
