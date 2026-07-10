import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'
import { Check, ChevronDown, Globe, Info, Pin } from 'lucide-react'
import type { ModelDTO } from '@shared/types/api'
import {
  effectiveReasoningEffort,
  findReasoningEffortOption,
  isReasoningEffortAllowed,
} from '@shared/util/reasoning'
import { effectiveWebSearchEnabled } from '@shared/util/webSearch'
import {
  GPT_IMAGE_2_SIZE_OPTIONS,
  formatImageSizeLabel,
  parseImageSize,
  validateGptImage2Size,
} from '@shared/util/imageSize'
import { ModelTagList } from '../components/ModelTags'
import { useHeightTransition } from '../hooks/useHeightTransition'
import { useModels } from '../hooks/useModels'
import { useChatPrefs } from '../store/chat'
import { useIsMobile } from '../store/sidebar'
import { ReasoningEffortIcon } from './icons'

/**
 * 桌面弹层方向：输入框内向上、顶栏向下（移动端为底部弹层，不用此参数）。
 * 'left' 为侧向弹层：贴触发器左侧、以其竖直中点为中心上下对称展开——
 * 用于新对话输入框居中时（此时上下都窄，横向才宽裕）。
 */
type MenuPlacement = 'up' | 'down' | 'left'

/** 首选（上/下）方向至少要有这么高才不翻转；不够且对侧更宽裕时换边。 */
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
 * 思考深度：横向分段选择（点击临时生效并保持菜单打开），高亮「本次请求实际会用」的档位，
 * 与触发器标签同口径；上游实际值（low/high…）保留在悬停提示里。
 * 右上角「固定」把当前档位设为新会话默认；已固定但当前未使用的档位以小圆点标记。
 */
function ReasoningSection({ model }: { model: ModelDTO }) {
  const activeEffort = useChatPrefs((s) => s.activeEffort)
  const setActiveEffort = useChatPrefs((s) => s.setActiveEffort)
  const pinnedEffort = useChatPrefs((s) => s.pinnedEffort)
  const pinEffort = useChatPrefs((s) => s.pinEffort)
  const activeSupportedEffort = isReasoningEffortAllowed(model, activeEffort) ? activeEffort : null
  const effectiveEffort = activeSupportedEffort ?? effectiveReasoningEffort(model)
  const pinnedSupported = isReasoningEffortAllowed(model, pinnedEffort) ? pinnedEffort : null
  const isPinnedCurrent = pinnedSupported !== null && pinnedSupported === effectiveEffort
  const effectiveOption = findReasoningEffortOption(model.allowedEfforts, effectiveEffort)
  const activeButtonRef = useRef<HTMLButtonElement>(null)

  // 档位较多需要横向滚动时，让当前生效项在首次打开和切换后始终可见。
  useLayoutEffect(() => {
    activeButtonRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [effectiveEffort])

  return (
    <div className="shrink-0 p-1.5">
      <SectionLabel
        action={
          effectiveEffort && (
            <button
              type="button"
              onClick={() => pinEffort(effectiveEffort)}
              aria-pressed={isPinnedCurrent}
              aria-label={
                isPinnedCurrent
                  ? `取消固定「${effectiveOption?.description ?? effectiveEffort}」`
                  : `固定「${effectiveOption?.description ?? effectiveEffort}」为新会话默认`
              }
              title={
                isPinnedCurrent
                  ? '已固定为新会话默认，点击取消固定'
                  : `将「${effectiveOption?.description ?? effectiveEffort}」固定为新会话默认`
              }
              className={clsx(
                'flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs transition',
                isPinnedCurrent
                  ? 'text-violet-500 hover:bg-violet-50 dark:text-violet-300 dark:hover:bg-violet-950/40'
                  : 'text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-300',
              )}
            >
              <Pin
                aria-hidden
                className={clsx('h-3 w-3 shrink-0', isPinnedCurrent && 'fill-current')}
              />
              {isPinnedCurrent ? '默认' : '固定'}
            </button>
          )
        }
      >
        <span className="inline-flex items-center gap-1.5">
          <ReasoningEffortIcon
            effort={effectiveEffort}
            className="h-3.5 w-3.5 shrink-0"
          />
          思考深度
        </span>
      </SectionLabel>
      <div
        role="group"
        aria-label="思考深度"
        className="hc-scrollbar flex gap-1 overflow-x-auto px-1.5 pb-1"
      >
        {model.allowedEfforts.map((option) => {
          const effort = option.value
          const isActive = effectiveEffort === option.value
          const isPinnedHere = pinnedSupported === option.value
          return (
            <button
              key={option.value}
              ref={isActive ? activeButtonRef : undefined}
              type="button"
              onClick={() => setActiveEffort(effort)}
              aria-pressed={isActive}
              aria-label={`${option.description}（${option.value}），本次会话临时生效${isPinnedHere ? '，新会话默认' : ''}`}
              title={`${option.description}（${option.value}），本次会话临时生效`}
              className={clsx(
                'relative flex h-9 items-center justify-center rounded-lg border px-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400',
                'min-w-12 max-w-40 flex-[1_0_auto] shrink-0',
                isActive
                  ? 'border-violet-200 bg-violet-50 text-violet-600 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300'
                  : 'border-transparent text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200',
              )}
            >
              <span className="max-w-full truncate">{option.description}</span>
              {isPinnedHere && !isActive && (
                <span
                  aria-hidden
                  title="新会话默认"
                  className="absolute right-1.5 top-1.5 h-1 w-1 rounded-full bg-violet-400"
                />
              )}
              {isPinnedHere && <span className="sr-only">新会话默认</span>}
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
        <Globe className="h-4 w-4 shrink-0 text-neutral-500 dark:text-neutral-400" />
        <span className="min-w-0 flex-1">联网搜索</span>
        <span
          aria-hidden
          className={clsx(
            'relative h-5 w-9 shrink-0 rounded-full transition',
            enabled ? 'bg-blue-500' : 'bg-neutral-300 dark:bg-neutral-700',
          )}
        >
          <span
            className={clsx(
              'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all',
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
function ImageParamsSection({ sheet }: { sheet: boolean }) {
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
              onClick={() => setImageSize(size)}
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
          className="flex h-8 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500 text-white transition hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-500"
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

/**
 * 桌面端模型描述提示：ⓘ 悬停/聚焦时经 portal 显示浮动气泡
 * （列表内部滚动会裁剪 absolute 子元素，必须用 fixed + portal 逃逸）。
 */
function ModelInfoTip({ name, description }: { name: string; description: string }) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)

  const show = () => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect) setAnchor({ x: rect.left + rect.width / 2, y: rect.top - 6 })
  }
  const hide = () => setAnchor(null)

  // 气泡 max-w-64（256px）：水平方向按半宽夹取，避免贴边溢出。
  const clampedX = anchor
    ? Math.min(Math.max(anchor.x, 8 + 128), window.innerWidth - 8 - 128)
    : 0

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`查看模型「${name}」的描述`}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-400 transition hover:text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:text-neutral-500 dark:hover:text-neutral-300"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {anchor &&
        createPortal(
          <div
            role="tooltip"
            style={{ left: clampedX, top: anchor.y }}
            className="hc-pop-in fixed z-[70] max-w-64 -translate-x-1/2 -translate-y-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-xs leading-5 text-neutral-600 shadow-lg dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
          >
            {description}
          </div>,
          document.body,
        )}
    </>
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
  // 移动端点按 ⓘ 展开的模型描述（一次只展开一条）。
  const [openDescriptionId, setOpenDescriptionId] = useState<string | null>(null)

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
          const descriptionOpen = sheet && openDescriptionId === m.id
          return (
            <div key={m.id} data-active={selected || undefined}>
              <div
                className={clsx(
                  'flex items-center rounded-lg transition hover:bg-neutral-100 dark:hover:bg-neutral-800',
                  selected && 'bg-neutral-100 dark:bg-neutral-800',
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelectModel(m.id)}
                  className={clsx(
                    'flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 text-left text-sm',
                    sheet ? 'py-2.5' : 'py-2',
                  )}
                >
                  <span className="min-w-0 shrink truncate text-neutral-800 dark:text-neutral-100">
                    {m.displayName}
                  </span>
                  <ModelTagList tags={m.tags} />
                  {m.kind === 'image' && (
                    <span className="shrink-0 text-xs text-neutral-400">生图</span>
                  )}
                  {selected && (
                    <Check className="ml-auto h-4 w-4 shrink-0 text-neutral-500 dark:text-neutral-400" />
                  )}
                </button>
                {m.description &&
                  (sheet ? (
                    <button
                      type="button"
                      aria-expanded={descriptionOpen}
                      aria-label={`查看模型「${m.displayName}」的描述`}
                      onClick={() =>
                        setOpenDescriptionId(descriptionOpen ? null : m.id)
                      }
                      className={clsx(
                        'mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition',
                        descriptionOpen
                          ? 'text-neutral-700 dark:text-neutral-200'
                          : 'text-neutral-400 dark:text-neutral-500',
                      )}
                    >
                      <Info className="h-4 w-4" />
                    </button>
                  ) : (
                    <ModelInfoTip name={m.displayName} description={m.description} />
                  ))}
              </div>
              {descriptionOpen && m.description && (
                <div className="px-3 pb-2 pt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
                  {m.description}
                </div>
              )}
            </div>
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
  sheet,
}: {
  models: ModelDTO[]
  model: ModelDTO | undefined
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
        onSelectModel={setActiveModel}
      />
      {showReasoning && (
        <>
          <Divider />
          <ReasoningSection model={model!} />
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
          <ImageParamsSection sheet={sheet} />
        </>
      )}
    </>
  )
}

/**
 * 聚合选择器：模型 + 思考深度 + 联网搜索（图片模型则为分辨率/画质）收进一个菜单。
 * 桌面端为锚定弹层（输入框内向上、顶栏向下，空间不足自动翻转；新对话居中时向左侧弹）；
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
  /**
   * 侧向弹层的水平锚点（距触发器右缘的 right 偏移）：打开时按当时的触发器宽度冻结。
   * 触发器右缘在输入框里是稳定的，标签文字（模型名/思考深度）变化只会改左缘——
   * 若按左缘锚定（right-full），切换选项就会带着整个面板左右晃动。
   */
  const [menuSideOffset, setMenuSideOffset] = useState<number | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const desktopPanelRef = useRef<HTMLDivElement>(null)
  const mobileDialogRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  const model = models?.find((m) => m.id === activeModelId)
  // 切换模型后分区增减（思考/联网/图片参数）会改变面板尺寸：让高度平滑过渡而非跳变。
  useHeightTransition(desktopPanelRef, model?.id)
  useHeightTransition(mobileDialogRef, model?.id)

  useLayoutEffect(() => {
    if (!open || !isMobile) return
    mobileDialogRef.current?.focus()
  }, [open, isMobile])

  useLayoutEffect(() => {
    if (!open || isMobile) return
    const syncPosition = () => {
      const rect = rootRef.current?.getBoundingClientRect()
      if (!rect) return
      if (placement === 'left') {
        // 侧向弹层以触发器竖直中点为中心上下对称展开，按较窄一侧限高保证完整可见。
        const center = rect.top + rect.height / 2
        const half = Math.min(center - 12, window.innerHeight - center - 12)
        setEffectivePlacement('left')
        setMenuMaxHeight(Math.max(180, Math.floor(half * 2)))
        setMenuSideOffset(rect.width + 8)
        return
      }
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
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
        return
      }
      if (event.key === 'Tab' && isMobile && mobileDialogRef.current) {
        const focusable = Array.from(
          mobileDialogRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
          ),
        )
        if (focusable.length === 0) {
          event.preventDefault()
          return
        }
        const first = focusable[0]!
        const last = focusable[focusable.length - 1]!
        const activeElement = document.activeElement
        if (
          event.shiftKey &&
          (activeElement === first ||
            activeElement === mobileDialogRef.current ||
            !mobileDialogRef.current.contains(activeElement))
        ) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
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

  const isImage = model?.kind === 'image'
  const showReasoning = Boolean(
    model && !isImage && model.capabilities.reasoning && model.allowedEfforts.length > 0,
  )
  const showWebSearch = Boolean(model && !isImage && model.capabilities.web_search)

  // 触发器上直接反映本次请求会用到的思考深度与联网状态。
  const activeSupportedEffort = isReasoningEffortAllowed(model, activeEffort) ? activeEffort : null
  const effectiveEffort = model ? (activeSupportedEffort ?? effectiveReasoningEffort(model)) : null
  const webEnabled = model ? (activeWebSearch ?? effectiveWebSearchEnabled(model)) : false
  const effectiveEffortOption = model
    ? findReasoningEffortOption(model.allowedEfforts, effectiveEffort)
    : null
  const effortLabel = showReasoning ? (effectiveEffortOption?.description ?? '自动') : null

  const close = () => {
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  const menuPositionClass = clsx(
    'absolute z-40',
    effectivePlacement === 'left'
      ? // 贴触发器左侧、竖直居中；水平位置用打开时冻结的 right 偏移（见 menuSideOffset）。
        'top-1/2 -translate-y-1/2'
      : clsx(
          effectivePlacement === 'up' ? 'bottom-full mb-2' : 'top-full mt-2',
          align === 'end' ? 'right-0' : 'left-0',
        ),
  )
  // 侧向弹层首帧 syncPosition 尚未跑完时回退到等价的 right-full + mr-2。
  const menuPositionStyle =
    effectivePlacement === 'left' ? { right: menuSideOffset ?? 'calc(100% + 0.5rem)' } : undefined

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        data-testid="model-menu-trigger"
        aria-haspopup="dialog"
        aria-controls={menuId}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={
          model
            ? `模型：${model.displayName}${showReasoning ? `；思考深度：${effectiveEffortOption ? `${effectiveEffortOption.description}（${effectiveEffortOption.value}）` : '自动（沿用上游默认）'}` : ''}`
            : '选择模型'
        }
        className={clsx(
          'flex max-w-[15rem] items-center gap-1.5 transition',
          variant === 'composer'
            ? 'h-9 rounded-full px-2.5 text-[13px] font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
            : 'rounded-lg px-2 py-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800',
          open && 'bg-neutral-100 dark:bg-neutral-800',
        )}
      >
        <span className="truncate">{model?.displayName ?? '选择模型'}</span>
        {effortLabel && (
          <span className="inline-flex min-w-0 shrink items-center gap-1 text-neutral-400 dark:text-neutral-400">
            <span aria-hidden>·</span>
            <span className="truncate">{effortLabel}</span>
          </span>
        )}
        {showWebSearch && webEnabled && (
          <Globe className="h-3.5 w-3.5 shrink-0 text-neutral-400 dark:text-neutral-500" aria-label="联网已开启" />
        )}
        <ChevronDown
          className={clsx(
            'h-3.5 w-3.5 shrink-0 text-neutral-400 transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && !isMobile && (
        <div className={menuPositionClass} style={menuPositionStyle}>
          <div
            id={menuId}
            ref={desktopPanelRef}
            role="dialog"
            aria-label="模型与参数"
            className="hc-pop-in hc-scrollbar flex max-h-[min(70vh,32rem)] w-80 max-w-[calc(100vw-1.5rem)] flex-col overflow-y-auto rounded-2xl border border-neutral-200 bg-white text-neutral-700 shadow-[0_12px_40px_rgb(0_0_0/0.14)] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:shadow-[0_12px_40px_rgb(0_0_0/0.45)]"
            style={{
              ...(menuMaxHeight !== null ? { maxHeight: menuMaxHeight } : null),
              // 缩放动画从贴近触发器的一侧展开：向上弹用 bottom、侧向弹用 right，其余用 top。
              transformOrigin:
                effectivePlacement === 'left'
                  ? 'right'
                  : effectivePlacement === 'up'
                    ? 'bottom'
                    : 'top',
            }}
          >
            <MenuSections models={models} model={model} sheet={false} />
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
              id={menuId}
              ref={mobileDialogRef}
              role="dialog"
              aria-modal="true"
              aria-label="模型与参数"
              tabIndex={-1}
              className="hc-sheet-in relative flex max-h-[min(78dvh,42rem)] flex-col rounded-t-[20px] bg-white px-1.5 pb-[max(env(safe-area-inset-bottom),0.5rem)] text-neutral-700 shadow-[0_-12px_40px_rgb(0_0_0/0.18)] dark:bg-neutral-900 dark:text-neutral-100 dark:shadow-[0_-12px_40px_rgb(0_0_0/0.55)]"
            >
              {/* 顶部抓手：视觉提示可下滑关闭（点击遮罩关闭）。 */}
              <div className="flex shrink-0 justify-center pb-0.5 pt-2.5">
                <span className="h-1 w-9 rounded-full bg-neutral-300 dark:bg-neutral-600" />
              </div>
              <MenuSections models={models} model={model} sheet />
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
