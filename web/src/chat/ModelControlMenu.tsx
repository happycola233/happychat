import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
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
import { ReasoningEffortIcon } from './icons'

/** 菜单弹出方向：输入框内向上、移动端顶栏向下。 */
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

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 pb-1 pt-2 text-xs font-medium text-neutral-400 dark:text-neutral-500">
      {children}
    </div>
  )
}

function Divider() {
  return <div className="mx-1.5 my-1 shrink-0 border-t border-neutral-100 dark:border-neutral-800" />
}

/** 思考深度选项：点击临时启用，图钉设为固定默认（与旧 ReasoningSelect 行为一致）。 */
function ReasoningSection({ model, onSelect }: { model: ModelDTO; onSelect: () => void }) {
  const activeEffort = useChatPrefs((s) => s.activeEffort)
  const setActiveEffort = useChatPrefs((s) => s.setActiveEffort)
  const pinnedEffort = useChatPrefs((s) => s.pinnedEffort)
  const pinEffort = useChatPrefs((s) => s.pinEffort)
  const activeSupportedEffort = isReasoningEffortAllowed(model, activeEffort) ? activeEffort : null

  return (
    <div className="shrink-0 p-1">
      <SectionLabel>思考深度</SectionLabel>
      {model.allowedEfforts.map((effort) => {
        const isActive = activeSupportedEffort === effort
        const isPinned = pinnedEffort === effort
        return (
          <div
            key={effort}
            className={clsx(
              'flex items-center rounded-lg pr-1 transition hover:bg-neutral-100 dark:hover:bg-neutral-800',
              isActive && 'bg-violet-50 dark:bg-violet-950/40',
            )}
          >
            <button
              type="button"
              onClick={() => {
                setActiveEffort(isActive ? null : effort)
                onSelect()
              }}
              title="临时使用这个思考深度"
              className={clsx(
                'flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left text-sm',
                isActive && 'text-violet-600 dark:text-violet-300',
              )}
            >
              <ReasoningEffortIcon effort={effort} className="block h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{REASONING_EFFORT_OPTION_LABELS[effort]}</span>
            </button>
            <button
              type="button"
              onClick={() => pinEffort(effort)}
              title={isPinned ? '取消固定默认' : '设为默认（固定）'}
              className="rounded-md p-1.5 transition hover:bg-neutral-200/70 dark:hover:bg-neutral-700"
            >
              <Pin
                className={clsx(
                  'h-3.5 w-3.5 shrink-0',
                  isPinned ? 'fill-current text-violet-500' : 'text-neutral-300 dark:text-neutral-600',
                )}
              />
            </button>
          </div>
        )
      })}
    </div>
  )
}

/** 联网搜索开关行：整行可点、开关不关闭菜单（开关视觉内联渲染，避免 button 嵌套）。 */
function WebSearchSection({ model }: { model: ModelDTO }) {
  const activeWebSearch = useChatPrefs((s) => s.activeWebSearch)
  const setActiveWebSearch = useChatPrefs((s) => s.setActiveWebSearch)
  const enabled = activeWebSearch ?? effectiveWebSearchEnabled(model)
  return (
    <div className="shrink-0 p-1">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        data-testid="web-search-toggle"
        onClick={() => setActiveWebSearch(!enabled)}
        title={activeWebSearch === null ? '联网搜索（使用模型默认）' : '联网搜索（本次会话临时开关）'}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-neutral-700 transition hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
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

/** 图片模型参数：分辨率预设 + 自定义宽高、画质分段选择。 */
function ImageParamsSection({ onSizeSelect }: { onSizeSelect: () => void }) {
  const { imageSize, imageQuality, setImageSize, setImageQuality } = useChatPrefs()
  const [width, setWidth] = useState('1024')
  const [height, setHeight] = useState('1024')
  const [error, setError] = useState<string | null>(null)

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

  return (
    <div className="shrink-0 p-1">
      <SectionLabel>分辨率</SectionLabel>
      <div className="hc-scrollbar max-h-40 overflow-y-auto">
        {GPT_IMAGE_2_SIZE_OPTIONS.map((size) => (
          <button
            key={size}
            type="button"
            onClick={() => {
              setImageSize(size)
              onSizeSelect()
            }}
            className={clsx(
              'flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-sm transition hover:bg-neutral-100 dark:hover:bg-neutral-800',
              imageSize === size && 'bg-neutral-100 dark:bg-neutral-800',
            )}
          >
            <span>{formatImageSizeLabel(size)}</span>
            {imageSize === size && <Check className="h-4 w-4 shrink-0 text-neutral-500" />}
          </button>
        ))}
      </div>
      <div className="mt-1 border-t border-neutral-100 px-2 py-2 dark:border-neutral-800">
        <div className="mb-1 text-xs text-neutral-400">自定义</div>
        <div className="flex items-center gap-1.5">
          <input
            value={width}
            onChange={(e) => setWidth(e.target.value)}
            inputMode="numeric"
            className="h-8 w-full min-w-0 rounded-lg border border-neutral-200 bg-white px-2 text-center text-sm tabular-nums text-neutral-900 outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
            aria-label="图片宽度"
          />
          <span className="shrink-0 text-xs text-neutral-400">×</span>
          <input
            value={height}
            onChange={(e) => setHeight(e.target.value)}
            inputMode="numeric"
            className="h-8 w-full min-w-0 rounded-lg border border-neutral-200 bg-white px-2 text-center text-sm tabular-nums text-neutral-900 outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
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
        {error && <div className="mt-1 text-xs text-red-500">{error}</div>}
      </div>
      <SectionLabel>画质</SectionLabel>
      <div className="mx-1.5 mb-1 inline-flex w-[calc(100%-0.75rem)] rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-800">
        {qualityOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setImageQuality(option.value)}
            className={clsx(
              'flex-1 rounded-md px-2 py-1 text-[13px] font-medium transition',
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
  )
}

/**
 * 聚合选择器：模型 + 思考深度 + 联网搜索（图片模型则为分辨率/画质）收进一个菜单。
 * 桌面端挂在输入框发送按钮左侧向上弹出；移动端挂在顶栏向下弹出。
 */
export function ModelControlMenu({ placement, align, variant }: Props) {
  const { data: models } = useModels()
  const activeModelId = useChatPrefs((s) => s.activeModelId)
  const setActiveModel = useChatPrefs((s) => s.setActiveModel)
  const activeEffort = useChatPrefs((s) => s.activeEffort)
  const activeWebSearch = useChatPrefs((s) => s.activeWebSearch)
  const [open, setOpen] = useState(false)
  // 弹层实际弹出方向与限高：首选方向空间不足且对侧更宽裕时翻转，再按所选方向的空间限高。
  const [effectivePlacement, setEffectivePlacement] = useState<MenuPlacement>(placement)
  const [menuMaxHeight, setMenuMaxHeight] = useState<number | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open) return
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
  }, [open, placement])

  // 当前无有效选择（首次使用或所选已失效）时，回退首个可用模型
  useEffect(() => {
    if (!models?.length) return
    if (!activeModelId || !models.some((m) => m.id === activeModelId)) {
      setActiveModel(models[0]!.id)
    }
  }, [models, activeModelId, setActiveModel])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

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

      {open && (
        <div className={menuPositionClass}>
          {/* 弹性布局：思考/联网/图片参数分区始终可见，只有模型列表在空间不足时内部滚动。 */}
          <div
            className="hc-pop-in hc-scrollbar flex max-h-[min(70vh,30rem)] w-72 max-w-[calc(100vw-1.5rem)] flex-col overflow-y-auto rounded-2xl border border-neutral-200 bg-white text-neutral-700 shadow-[0_12px_40px_rgb(0_0_0/0.14)] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:shadow-[0_12px_40px_rgb(0_0_0/0.45)]"
            style={menuMaxHeight !== null ? { maxHeight: menuMaxHeight } : undefined}
          >
            {/* 模型列表可收缩，但至少保住约 3.5 行的可视高度，避免被其它分区挤成一条缝。 */}
            <div className="flex min-h-[10rem] min-w-0 flex-col p-1">
              <SectionLabel>模型</SectionLabel>
              <div className="hc-scrollbar min-h-0 flex-1 overflow-y-auto">
                {models.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setActiveModel(m.id)
                      setOpen(false)
                    }}
                    className={clsx(
                      'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition hover:bg-neutral-100 dark:hover:bg-neutral-800',
                      m.id === activeModelId && 'bg-neutral-100 dark:bg-neutral-800',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate text-neutral-800 dark:text-neutral-100">
                      {m.displayName}
                    </span>
                    {m.kind === 'image' && <span className="shrink-0 text-xs text-neutral-400">生图</span>}
                    {m.id === activeModelId && <Check className="h-4 w-4 shrink-0 text-neutral-500" />}
                  </button>
                ))}
              </div>
            </div>

            {showReasoning && (
              <>
                <Divider />
                <ReasoningSection model={model!} onSelect={() => setOpen(false)} />
              </>
            )}
            {showWebSearch && (
              <>
                <Divider />
                <WebSearchSection model={model!} />
              </>
            )}
            {isImage && (
              <>
                <Divider />
                <ImageParamsSection onSizeSelect={() => setOpen(false)} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
