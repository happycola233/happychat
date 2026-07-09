import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'
import { Check, ChevronDown, Globe, Pin } from 'lucide-react'
import type { ModelDTO } from '@shared/types/api'
import { effectiveReasoningEffort, isReasoningEffortAllowed } from '@shared/util/reasoning'
import { effectiveWebSearchEnabled } from '@shared/util/webSearch'
import {
  GPT_IMAGE_2_SIZE_OPTIONS,
  formatImageSizeLabel,
  parseImageSize,
  validateGptImage2Size,
} from '@shared/util/imageSize'
import { useModels } from '../hooks/useModels'
import {
  REASONING_EFFORT_OPTION_LABELS,
  REASONING_EFFORT_SHORT_LABELS,
} from '../lib/reasoningLabels'
import { useChatPrefs } from '../store/chat'
import { useIsMobile } from '../store/sidebar'
import { ReasoningEffortIcon } from './icons'

/** 桌面弹层方向：输入框内向上、顶栏向下（移动端为底部弹层，不用此参数）。 */
type MenuPlacement = 'up' | 'down'

/** 首选方向至少要有这么高才不翻转；不够且对侧更宽裕时换边（如新对话输入框居中时向下弹）。 */
const COMFORTABLE_MENU_HEIGHT_PX = 420
/** 菜单与触发器的对齐边。 */
type MenuAlign = 'start' | 'end'
/** 触发器外观：composer=输入框内胶囊；header=顶栏文字按钮。 */
type TriggerVariant = 'composer' | 'header'

interface Props {
  placement: MenuPlacement
  align: MenuAlign
  variant: TriggerVariant
}

/** 分区标题行：左侧标题文本独立成元素（E2E 依赖精确文本），右侧可挂操作按钮。 */
function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 pb-1.5 pt-2">
      <div className="text-xs font-medium text-neutral-400 dark:text-neutral-500">{children}</div>
      {action}
    </div>
  )
}

function Divider() {
  return <div className="mx-2 shrink-0 border-t border-neutral-100 dark:border-neutral-800" />
}

/**
 * 思考深度：横向分段选择（点击临时生效并关闭菜单），高亮「本次请求实际会用」的档位，
 * 与触发器标签同口径；上游实际值（low/high…）保留在悬停提示里。
 * 右上角「固定」把当前档位设为新会话默认；已固定但当前未使用的档位以小圆点标记。
 */
function ReasoningSection({ model, onSelect }: { model: ModelDTO; onSelect: () => void }) {
  const activeEffort = useChatPrefs((s) => s.activeEffort)
  const setActiveEffort = useChatPrefs((s) => s.setActiveEffort)
  const pinnedEffort = useChatPrefs((s) => s.pinnedEffort)
  const pinEffort = useChatPrefs((s) => s.pinEffort)
  const activeSupportedEffort = isReasoningEffortAllowed(model, activeEffort) ? activeEffort : null
  const effectiveEffort = activeSupportedEffort ?? effectiveReasoningEffort(model)
  const pinnedSupported = isReasoningEffortAllowed(model, pinnedEffort) ? pinnedEffort : null
  const isPinnedCurrent = pinnedSupported !== null && pinnedSupported === effectiveEffort

  return (
    <div className="shrink-0 p-1.5">
      <SectionLabel
        action={
          effectiveEffort && (
            <button
              type="button"
              onClick={() => pinEffort(effectiveEffort)}
              title={
                isPinnedCurrent
                  ? '已固定为新会话默认，点击取消固定'
                  : `将「${REASONING_EFFORT_SHORT_LABELS[effectiveEffort]}」固定为新会话默认`
              }
              className={clsx(
                'flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs transition',
                isPinnedCurrent
                  ? 'text-violet-500 hover:bg-violet-50 dark:text-violet-300 dark:hover:bg-violet-950/40'
                  : 'text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-300',
              )}
            >
              <Pin className={clsx('h-3 w-3 shrink-0', isPinnedCurrent && 'fill-current')} />
              {isPinnedCurrent ? '默认' : '固定'}
            </button>
          )
        }
      >
        思考深度
      </SectionLabel>
      <div className="flex gap-1 px-1.5 pb-1">
        {model.allowedEfforts.map((effort) => {
          const isActive = effectiveEffort === effort
          const isPinnedHere = pinnedSupported === effort
          return (
            <button
              key={effort}
              type="button"
              onClick={() => {
                setActiveEffort(effort)
                onSelect()
              }}
              title={`${REASONING_EFFORT_OPTION_LABELS[effort]}，本次会话临时生效`}
              className={clsx(
                'relative flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl border px-1 py-1.5 text-xs transition',
                isActive
                  ? 'border-violet-200 bg-violet-50 text-violet-600 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300'
                  : 'border-transparent text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200',
              )}
            >
              <ReasoningEffortIcon effort={effort} className="block h-4 w-4 shrink-0" />
              <span className="max-w-full truncate">{REASONING_EFFORT_SHORT_LABELS[effort]}</span>
              {isPinnedHere && !isActive && (
                <span
                  aria-hidden
                  title="新会话默认"
                  className="absolute right-1.5 top-1.5 h-1 w-1 rounded-full bg-violet-400"
                />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** 联网搜索开关行：整行可点、开关不关闭菜单（开关视觉内联渲染，避免 button 嵌套）。 */
function WebSearchSection({ model, sheet }: { model: ModelDTO; sheet: boolean }) {
  const activeWebSearch = useChatPrefs((s) => s.activeWebSearch)
  const setActiveWebSearch = useChatPrefs((s) => s.setActiveWebSearch)
  const enabled = activeWebSearch ?? effectiveWebSearchEnabled(model)
  return (
    <div className="shrink-0 p-1.5">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        data-testid="web-search-toggle"
        onClick={() => setActiveWebSearch(!enabled)}
        title={activeWebSearch === null ? '联网搜索（使用模型默认）' : '联网搜索（本次会话临时开关）'}
        className={clsx(
          'flex w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm text-neutral-700 transition hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800',
          sheet ? 'py-2.5' : 'py-2',
        )}
      >
        <Globe className={clsx('h-4 w-4 shrink-0', enabled && 'text-blue-500 dark:text-blue-400')} />
        <span className="min-w-0 flex-1">联网搜索</span>
        <span
          aria-hidden
          className={clsx(
            'relative h-5 w-9 shrink-0 rounded-full transition',
            enabled ? 'bg-neutral-900 dark:bg-white' : 'bg-neutral-300 dark:bg-neutral-700',
          )}
        >
          <span
            className={clsx(
              'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all dark:bg-neutral-900',
              enabled ? 'left-[18px]' : 'left-0.5',
            )}
          />
        </span>
      </button>
    </div>
  )
}

/** 分辨率比例缩略图：按宽高比绘制小圆角矩形（长边恒定），auto 用虚线方框表示「不固定」。 */
function AspectGlyph({ size }: { size: string }) {
  const parsed = parseImageSize(size)
  const LONG_EDGE_PX = 15
  let width = 11
  let height = 11
  if (parsed) {
    const ratio = parsed.width / parsed.height
    width = ratio >= 1 ? LONG_EDGE_PX : Math.max(7, Math.round(LONG_EDGE_PX * ratio))
    height = ratio >= 1 ? Math.max(7, Math.round(LONG_EDGE_PX / ratio)) : LONG_EDGE_PX
  }
  return (
    <span aria-hidden className="flex h-4 w-4 items-center justify-center">
      <span
        className={clsx('rounded-[3px] border-[1.5px] border-current', !parsed && 'border-dashed')}
        style={{ width, height }}
      />
    </span>
  )
}

/** 图片模型参数：分辨率预设网格（比例缩略图）+ 自定义宽高 + 画质分段选择。
    整个分区必须始终完整可见（不允许滚动），所以自定义/画质压成单行排布。 */
function ImageParamsSection({ onSizeSelect, sheet }: { onSizeSelect: () => void; sheet: boolean }) {
  const { imageSize, imageQuality, setImageSize, setImageQuality } = useChatPrefs()
  const [width, setWidth] = useState('1024')
  const [height, setHeight] = useState('1024')
  const [error, setError] = useState<string | null>(null)
  // 当前值不在预设里时视为自定义生效，高亮自定义输入区。
  const isCustomActive = !(GPT_IMAGE_2_SIZE_OPTIONS as readonly string[]).includes(imageSize)

  useEffect(() => {
    const parsed = parseImageSize(imageSize)
    if (parsed) {
      setWidth(String(parsed.width))
      setHeight(String(parsed.height))
    }
    setError(null)
  }, [imageSize])

  const applyCustom = () => {
    const normalizedWidth = width.trim()
    const normalizedHeight = height.trim()
    if (!/^\d+$/.test(normalizedWidth) || !/^\d+$/.test(normalizedHeight)) {
      setError('宽高必须是整数')
      return
    }
    const result = validateGptImage2Size(`${normalizedWidth}x${normalizedHeight}`)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setImageSize(result.normalizedSize)
    setError(null)
  }

  const qualityOptions = [
    { value: 'auto', label: '自动' },
    { value: 'low', label: '低' },
    { value: 'medium', label: '中' },
    { value: 'high', label: '高' },
  ]

  // 自定义/画质行首的对齐标签宽度，与分辨率网格左缘对齐。
  const inlineLabelClass = 'w-9 shrink-0 text-xs'

  return (
    <div className="shrink-0 p-1.5">
      <SectionLabel>分辨率</SectionLabel>
      <div className="grid grid-cols-3 gap-1 px-1.5">
        {GPT_IMAGE_2_SIZE_OPTIONS.map((size) => {
          const selected = imageSize === size
          return (
            <button
              key={size}
              type="button"
              onClick={() => {
                setImageSize(size)
                onSizeSelect()
              }}
              className={clsx(
                'flex items-center justify-center gap-1.5 rounded-lg border px-1 text-[11px] tabular-nums transition',
                sheet ? 'py-2' : 'py-1.5',
                selected
                  ? 'border-neutral-300 bg-neutral-100 text-neutral-900 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100'
                  : 'border-transparent text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200',
              )}
            >
              <AspectGlyph size={size} />
              <span className="truncate">{formatImageSizeLabel(size)}</span>
            </button>
          )
        })}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 px-1.5">
        <span
          className={clsx(
            inlineLabelClass,
            isCustomActive
              ? 'font-medium text-neutral-700 dark:text-neutral-200'
              : 'text-neutral-400 dark:text-neutral-500',
          )}
        >
          自定义
        </span>
        <input
          value={width}
          onChange={(e) => setWidth(e.target.value)}
          inputMode="numeric"
          className={clsx(
            'h-8 w-full min-w-0 rounded-lg border bg-white px-2 text-center text-sm tabular-nums text-neutral-900 outline-none focus:border-neutral-400 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:border-neutral-500',
            isCustomActive
              ? 'border-neutral-300 dark:border-neutral-600'
              : 'border-neutral-200 dark:border-neutral-700',
          )}
          aria-label="图片宽度"
        />
        <span className="shrink-0 text-xs text-neutral-400">×</span>
        <input
          value={height}
          onChange={(e) => setHeight(e.target.value)}
          inputMode="numeric"
          className={clsx(
            'h-8 w-full min-w-0 rounded-lg border bg-white px-2 text-center text-sm tabular-nums text-neutral-900 outline-none focus:border-neutral-400 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:border-neutral-500',
            isCustomActive
              ? 'border-neutral-300 dark:border-neutral-600'
              : 'border-neutral-200 dark:border-neutral-700',
          )}
          aria-label="图片高度"
        />
        <button
          type="button"
          onClick={applyCustom}
          className="flex h-8 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-900 text-white transition hover:bg-neutral-700 dark:bg-white dark:text-neutral-900"
          aria-label="应用自定义分辨率"
          title="应用"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
      </div>
      {error && <div className="mt-1 pl-[3.375rem] pr-1.5 text-xs text-red-500">{error}</div>}
      <div className="mt-1.5 flex items-center gap-1.5 px-1.5 pb-0.5">
        <span className={clsx(inlineLabelClass, 'text-neutral-400 dark:text-neutral-500')}>画质</span>
        <div className="inline-flex min-w-0 flex-1 rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-800">
          {qualityOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setImageQuality(option.value)}
              className={clsx(
                'flex-1 rounded-md px-2 text-[13px] font-medium transition',
                sheet ? 'py-1.5' : 'py-1',
                imageQuality === option.value
                  ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-600 dark:text-white'
                  : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/** 模型列表：唯一允许内部滚动的分区，打开时自动把选中项滚进可视区。 */
function ModelListSection({
  models,
  activeModelId,
  onSelectModel,
  sheet,
}: {
  models: ModelDTO[]
  activeModelId: string | null
  onSelectModel: (id: string) => void
  sheet: boolean
}) {
  const listRef = useRef<HTMLDivElement>(null)

  // 菜单打开即挂载本组件：首帧把选中模型滚进列表可视区，长列表不用找。
  useLayoutEffect(() => {
    listRef.current?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' })
  }, [])

  return (
    <div className="flex min-h-[9.5rem] min-w-0 flex-col p-1.5 pb-1">
      <SectionLabel>模型</SectionLabel>
      <div ref={listRef} className="hc-scrollbar min-h-0 flex-1 overflow-y-auto">
        {models.map((m) => {
          const selected = m.id === activeModelId
          return (
            <button
              key={m.id}
              type="button"
              data-active={selected || undefined}
              onClick={() => onSelectModel(m.id)}
              className={clsx(
                'flex w-full items-center gap-2 rounded-lg px-3 text-left text-sm transition hover:bg-neutral-100 dark:hover:bg-neutral-800',
                sheet ? 'py-2.5' : 'py-2',
                selected && 'bg-neutral-100 dark:bg-neutral-800',
              )}
            >
              <span className="min-w-0 flex-1 truncate text-neutral-800 dark:text-neutral-100">
                {m.displayName}
              </span>
              {m.kind === 'image' && <span className="shrink-0 text-xs text-neutral-400">生图</span>}
              {selected && <Check className="h-4 w-4 shrink-0 text-neutral-500 dark:text-neutral-400" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * 面板内容（桌面弹层与移动端底部弹层共用）：
 * 模型列表在空间不足时收缩滚动，思考/联网/图片参数分区始终完整可见。
 */
function MenuSections({
  models,
  model,
  onRequestClose,
  sheet,
}: {
  models: ModelDTO[]
  model: ModelDTO | undefined
  onRequestClose: () => void
  sheet: boolean
}) {
  const activeModelId = useChatPrefs((s) => s.activeModelId)
  const setActiveModel = useChatPrefs((s) => s.setActiveModel)
  const isImage = model?.kind === 'image'
  const showReasoning = Boolean(
    model && !isImage && model.capabilities.reasoning && model.allowedEfforts.length > 0,
  )
  const showWebSearch = Boolean(model && !isImage && model.capabilities.web_search)

  return (
    <>
      <ModelListSection
        models={models}
        activeModelId={activeModelId}
        sheet={sheet}
        onSelectModel={(id) => {
          setActiveModel(id)
          onRequestClose()
        }}
      />
      {showReasoning && (
        <>
          <Divider />
          <ReasoningSection model={model!} onSelect={onRequestClose} />
        </>
      )}
      {showWebSearch && (
        <>
          <Divider />
          <WebSearchSection model={model!} sheet={sheet} />
        </>
      )}
      {isImage && (
        <>
          <Divider />
          <ImageParamsSection onSizeSelect={onRequestClose} sheet={sheet} />
        </>
      )}
    </>
  )
}

/**
 * 聚合选择器：模型 + 思考深度 + 联网搜索（图片模型则为分辨率/画质）收进一个菜单。
 * 桌面端为锚定弹层（输入框内向上、顶栏向下，空间不足自动翻转）；
 * 移动端为底部弹层（portal 到 body，遮罩 + 安全区内边距 + 更大的触控行高）。
 */
export function ModelControlMenu({ placement, align, variant }: Props) {
  const { data: models } = useModels()
  const activeModelId = useChatPrefs((s) => s.activeModelId)
  const setActiveModel = useChatPrefs((s) => s.setActiveModel)
  const activeEffort = useChatPrefs((s) => s.activeEffort)
  const activeWebSearch = useChatPrefs((s) => s.activeWebSearch)
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  // 桌面弹层实际方向与限高：首选方向空间不足且对侧更宽裕时翻转，再按所选方向的空间限高。
  const [effectivePlacement, setEffectivePlacement] = useState<MenuPlacement>(placement)
  const [menuMaxHeight, setMenuMaxHeight] = useState<number | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open || isMobile) return
    const syncPosition = () => {
      const rect = rootRef.current?.getBoundingClientRect()
      if (!rect) return
      const spaceAbove = rect.top - 12
      const spaceBelow = window.innerHeight - rect.bottom - 12
      const preferredSpace = placement === 'up' ? spaceAbove : spaceBelow
      const otherSpace = placement === 'up' ? spaceBelow : spaceAbove
      const flip = preferredSpace < COMFORTABLE_MENU_HEIGHT_PX && otherSpace > preferredSpace
      const next: MenuPlacement = flip ? (placement === 'up' ? 'down' : 'up') : placement
      setEffectivePlacement(next)
      setMenuMaxHeight(Math.max(180, Math.floor(next === 'up' ? spaceAbove : spaceBelow)))
    }
    syncPosition()
    window.addEventListener('resize', syncPosition)
    return () => window.removeEventListener('resize', syncPosition)
  }, [open, placement, isMobile])

  // 当前无有效选择（首次使用或所选已失效）时，回退首个可用模型
  useEffect(() => {
    if (!models?.length) return
    if (!activeModelId || !models.some((m) => m.id === activeModelId)) {
      setActiveModel(models[0]!.id)
    }
  }, [models, activeModelId, setActiveModel])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    // 点击菜单外关闭仅用于桌面弹层；底部弹层由遮罩层负责（portal 在 rootRef 之外）。
    let removePointerDown: (() => void) | undefined
    if (!isMobile) {
      const onPointerDown = (event: PointerEvent) => {
        if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
      }
      window.addEventListener('pointerdown', onPointerDown)
      removePointerDown = () => window.removeEventListener('pointerdown', onPointerDown)
    }
    return () => {
      window.removeEventListener('keydown', onKey)
      removePointerDown?.()
    }
  }, [open, isMobile])

  if (!models?.length) {
    return <span className="px-2 text-sm text-neutral-400">暂无可用模型</span>
  }

  const model = models.find((m) => m.id === activeModelId)
  const isImage = model?.kind === 'image'
  const showReasoning = Boolean(
    model && !isImage && model.capabilities.reasoning && model.allowedEfforts.length > 0,
  )
  const showWebSearch = Boolean(model && !isImage && model.capabilities.web_search)

  // 触发器上直接反映本次请求会用到的思考深度与联网状态。
  const activeSupportedEffort = isReasoningEffortAllowed(model, activeEffort) ? activeEffort : null
  const effectiveEffort = model ? (activeSupportedEffort ?? effectiveReasoningEffort(model)) : null
  const webEnabled = model ? (activeWebSearch ?? effectiveWebSearchEnabled(model)) : false
  const effortLabel =
    showReasoning && effectiveEffort && effectiveEffort !== 'none'
      ? REASONING_EFFORT_SHORT_LABELS[effectiveEffort]
      : null

  const close = () => setOpen(false)

  const menuPositionClass = clsx(
    'absolute z-40',
    effectivePlacement === 'up' ? 'bottom-full mb-2 origin-bottom' : 'top-full mt-2 origin-top',
    align === 'end' ? 'right-0' : 'left-0',
  )

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        data-testid="model-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={model ? `模型：${model.displayName}` : '选择模型'}
        className={clsx(
          'flex max-w-[15rem] items-center gap-1.5 transition',
          variant === 'composer'
            ? 'h-9 rounded-full px-2.5 text-[13px] font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
            : 'rounded-lg px-2 py-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800',
          open && 'bg-neutral-100 dark:bg-neutral-800',
        )}
      >
        <span className="truncate">
          {model?.displayName ?? '选择模型'}
          {effortLabel && <span className="text-neutral-400 dark:text-neutral-500"> · {effortLabel}</span>}
        </span>
        {showWebSearch && webEnabled && (
          <Globe className="h-3.5 w-3.5 shrink-0 text-blue-500 dark:text-blue-400" aria-label="联网已开启" />
        )}
        <ChevronDown
          className={clsx(
            'h-3.5 w-3.5 shrink-0 text-neutral-400 transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && !isMobile && (
        <div className={menuPositionClass}>
          <div
            className="hc-pop-in hc-scrollbar flex max-h-[min(70vh,32rem)] w-80 max-w-[calc(100vw-1.5rem)] flex-col overflow-y-auto rounded-2xl border border-neutral-200 bg-white text-neutral-700 shadow-[0_12px_40px_rgb(0_0_0/0.14)] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:shadow-[0_12px_40px_rgb(0_0_0/0.45)]"
            style={{
              ...(menuMaxHeight !== null ? { maxHeight: menuMaxHeight } : null),
              // 弹层缩放动画从贴近触发器的一侧展开（hc-pop-in 默认 top，向上弹时改为 bottom）。
              transformOrigin: effectivePlacement === 'up' ? 'bottom' : 'top',
            }}
          >
            <MenuSections models={models} model={model} onRequestClose={close} sheet={false} />
          </div>
        </div>
      )}

      {open &&
        isMobile &&
        createPortal(
          <div className="fixed inset-0 z-[60] flex flex-col justify-end">
            <div
              aria-hidden
              className="hc-sheet-backdrop absolute inset-0 bg-black/40"
              onClick={close}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label="模型与参数"
              className="hc-sheet-in relative flex max-h-[min(78dvh,42rem)] flex-col rounded-t-[20px] bg-white px-1.5 pb-[max(env(safe-area-inset-bottom),0.5rem)] text-neutral-700 shadow-[0_-12px_40px_rgb(0_0_0/0.18)] dark:bg-neutral-900 dark:text-neutral-100 dark:shadow-[0_-12px_40px_rgb(0_0_0/0.55)]"
            >
              {/* 顶部抓手：视觉提示可下滑关闭（点击遮罩/选中即关）。 */}
              <div className="flex shrink-0 justify-center pb-0.5 pt-2.5">
                <span className="h-1 w-9 rounded-full bg-neutral-300 dark:bg-neutral-600" />
              </div>
              <MenuSections models={models} model={model} onRequestClose={close} sheet />
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
