import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'
import { Check, ChevronDown, ChevronLeft, ChevronRight, Info, Search, X } from 'lucide-react'
import type { ModelDTO, ModelGroupDTO } from '@shared/types/api'
import {
  DEFAULT_MODEL_ICON_TONE_CLASS,
  ModelGroupGlyph,
  ModelIconMark,
} from '../components/ModelIcon'
import { ModelTagList } from '../components/ModelTags'
import { useModelPickerStore } from '../store/modelPicker'
import {
  buildModelSections,
  filterModelSections,
  findSectionKeyOfModel,
  flattenSections,
  hasGroupStructure,
  openedSectionOnViewChange,
  resolveModelListView,
  sectionKey,
  sectionName,
  shouldShowModelParameters,
  type ModelListView,
  type ModelSection,
} from './modelGroups'

/**
 * 列对齐约定（工具栏 / 模型行 / 分组标题共用，保证同类元素纵向成列）：
 *
 * - 左侧图标列：有图标的一级元素（模型、真实分组、搜索、返回）都在 `pl-3` 处起始，
 *   紧跟的文字落在同一名称列；没有图标的「未分组」直接从 `pl-3` 起排文字，不保留空槽；
 *   分组成员**不再缩进**——层级由分组标题的字号与吸顶底色表达；
 * - 右侧操作列：统一 28px 槽位（`pr-2` + `w-7`），ⓘ / 折叠箭头 / 钻取箭头共用同一中心线；
 * - 选中勾：有描述时在 ⓘ 左侧独立占位；无描述时直接落进最右操作列，与其他行的 ⓘ 共用中心线；
 * - 分组标题的数量紧跟组名，不再吊在最右边与操作列抢位置。
 */
const TRAILING_SLOT_CLASS = 'flex w-7 shrink-0 items-center justify-center'
/** 覆盖在行上方的 ⓘ 按钮：绝对定位让整行保持可点，同时精确落在操作列中心。 */
const OVERLAY_INFO_BUTTON_CLASS =
  'absolute top-1/2 flex shrink-0 -translate-y-1/2 items-center justify-center rounded-md transition'
/**
 * 分组 / 返回标题条：吸顶且带面板底色，长列表滚动时始终知道当前在哪一组；
 * 字号与颜色明显轻于模型行，避免被误读成可选项（此前它与选中行同底色，最易混淆）。
 */
const HEADING_BAR_CLASS =
  'sticky top-0 z-10 flex w-full items-center gap-2 rounded-lg bg-white/90 py-1 pl-3 pr-2 text-left backdrop-blur-sm transition dark:bg-neutral-900/90'
const HEADING_TEXT_CLASS =
  'min-w-0 truncate text-[11px] font-semibold tracking-wide text-neutral-400 dark:text-neutral-500'
const HEADING_COUNT_CLASS =
  'shrink-0 text-[11px] tabular-nums text-neutral-300 dark:text-neutral-600'
/** 顶部工具栏上的图标按钮（搜索），与视图切换同规格。 */
const TOOLBAR_ICON_BUTTON_CLASS =
  'flex shrink-0 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-600 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-300'

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
  const clampedX = anchor ? Math.min(Math.max(anchor.x, 8 + 128), window.innerWidth - 8 - 128) : 0

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
        className={clsx(
          OVERLAY_INFO_BUTTON_CLASS,
          'right-2 h-7 w-7 text-neutral-400 hover:text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:text-neutral-500 dark:hover:text-neutral-300',
        )}
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

/** 单个模型行（两种视图共用）。 */
function ModelRow({
  model,
  selected,
  onSelect,
  sheet,
  descriptionOpen,
  onToggleDescription,
}: {
  model: ModelDTO
  selected: boolean
  onSelect: (id: string) => void
  sheet: boolean
  descriptionOpen: boolean
  onToggleDescription: () => void
}) {
  return (
    <div data-active={selected || undefined}>
      {/* relative 只包住行本身：ⓘ 覆盖在行上方，不受展开的描述影响垂直居中；
          group 让指针移到 ⓘ 上时整行底色不闪断 */}
      <div className="group relative">
        <button
          type="button"
          onClick={() => onSelect(model.id)}
          className={clsx(
            'flex w-full min-w-0 items-center gap-2 rounded-lg pl-3 pr-11 text-left text-sm transition group-hover:bg-neutral-100 dark:group-hover:bg-neutral-800',
            selected && 'bg-neutral-100 dark:bg-neutral-800',
            sheet ? 'py-2.5' : 'py-2',
          )}
        >
          <ModelIconMark
            icon={model.icon}
            modelId={model.modelId}
            displayName={model.displayName}
            size="sm"
            className={DEFAULT_MODEL_ICON_TONE_CLASS}
          />
          <span className="min-w-0 shrink truncate text-neutral-800 dark:text-neutral-100">
            {model.displayName}
          </span>
          <ModelTagList tags={model.tags} />
          {model.kind === 'image' && (
            <span className="shrink-0 text-xs text-neutral-400">生图</span>
          )}
          {model.description && (
            // 有 ⓘ 时勾选列留在它左侧；未选中仍占位，避免同类行的名称和标签左右跳动。
            <Check
              aria-hidden
              className={clsx(
                'ml-auto h-4 w-4 shrink-0',
                selected ? 'text-neutral-500 dark:text-neutral-400' : 'invisible',
              )}
            />
          )}
          {!model.description && selected && (
            // 没有描述时无需保留空的 ⓘ 槽，勾直接复用最右操作列的中心线。
            <span
              aria-hidden
              className={clsx(TRAILING_SLOT_CLASS, 'absolute right-2 top-1/2 h-7 -translate-y-1/2')}
            >
              <Check className="h-4 w-4 text-neutral-500 dark:text-neutral-400" />
            </span>
          )}
        </button>
        {model.description &&
          (sheet ? (
            <button
              type="button"
              aria-expanded={descriptionOpen}
              aria-label={`查看模型「${model.displayName}」的描述`}
              onClick={onToggleDescription}
              className={clsx(
                OVERLAY_INFO_BUTTON_CLASS,
                'right-1.5 h-8 w-8',
                descriptionOpen
                  ? 'text-neutral-700 dark:text-neutral-200'
                  : 'text-neutral-400 dark:text-neutral-500',
              )}
            >
              <Info className="h-4 w-4" />
            </button>
          ) : (
            <ModelInfoTip name={model.displayName} description={model.description} />
          ))}
      </div>
      {descriptionOpen && model.description && (
        <div className="pb-2 pl-3 pr-3 pt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
          {model.description}
        </div>
      )}
    </div>
  )
}

/**
 * 展开态搜索框：与视图切换同处一条 28px 工具栏（自身 flex-1），无边框浅填充。
 * 放大镜与占位文字分别落在图标列与名称列上；`size={1}` 掩掉 input 的固有宽度，
 * 否则 `w-fit` 的面板会在展开搜索时被撑宽而跳变。
 * 尾部按钮有内容时清空、已空时收起，Escape / 失焦为空同样收起。
 */
function ModelSearchBox({
  value,
  onChange,
  onClose,
  sheet,
}: {
  value: string
  onChange: (value: string) => void
  onClose: () => void
  sheet: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="relative min-w-0 flex-1">
      <Search
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400 dark:text-neutral-500"
      />
      <input
        ref={inputRef}
        size={1}
        autoFocus
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => {
          if (!value) onClose()
        }}
        placeholder="搜索模型"
        aria-label="搜索模型"
        className={clsx(
          'w-full rounded-lg bg-neutral-100/70 pl-9 pr-8 text-sm text-neutral-800 outline-none ring-inset transition placeholder:text-neutral-400 focus:bg-neutral-100 focus-visible:ring-1 focus-visible:ring-black/5 dark:bg-neutral-800/50 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:bg-neutral-800 dark:focus-visible:ring-white/10',
          sheet ? 'h-8' : 'h-7',
        )}
      />
      <button
        type="button"
        // 先 preventDefault 保住输入焦点，否则 blur 会先把搜索框收掉、这次点击落空
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (!value) {
            onClose()
            return
          }
          onChange('')
          inputRef.current?.focus()
        }}
        aria-label={value ? '清空搜索' : '收起搜索框'}
        className="absolute right-0.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-neutral-400 transition hover:text-neutral-600 dark:hover:text-neutral-300"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

interface ListProps {
  sections: ModelSection[]
  activeModelId: string | null
  onSelectModel: (id: string) => void
  sheet: boolean
  /** 移动端点按 ⓘ 展开的模型描述（一次只展开一条） */
  openDescriptionId: string | null
  setOpenDescriptionId: (id: string | null) => void
}

/** 平铺视图：单列滚动，分组标题可折叠；没有任何分组时退化为无标题列表。 */
function FlatList({
  sections,
  activeModelId,
  onSelectModel,
  sheet,
  openDescriptionId,
  setOpenDescriptionId,
  collapsible,
}: ListProps & { collapsible: boolean }) {
  const collapsedGroups = useModelPickerStore((s) => s.collapsedGroups)
  const toggleGroupCollapsed = useModelPickerStore((s) => s.toggleGroupCollapsed)
  const grouped = collapsible && hasGroupStructure(sections)

  if (!grouped) {
    return (
      <>
        {flattenSections(sections).map((model) => (
          <ModelRow
            key={model.id}
            model={model}
            selected={model.id === activeModelId}
            onSelect={onSelectModel}
            sheet={sheet}
            descriptionOpen={sheet && openDescriptionId === model.id}
            onToggleDescription={() =>
              setOpenDescriptionId(openDescriptionId === model.id ? null : model.id)
            }
          />
        ))}
      </>
    )
  }

  return (
    <>
      {sections.map((section) => {
        const key = sectionKey(section)
        const collapsed = collapsedGroups[key] ?? false
        const containsActive = section.models.some((model) => model.id === activeModelId)
        return (
          <div
            key={key}
            data-active={collapsed && containsActive ? true : undefined}
            className="mt-1 first:mt-0"
          >
            <button
              type="button"
              onClick={() => toggleGroupCollapsed(key)}
              aria-expanded={!collapsed}
              className={clsx(
                HEADING_BAR_CLASS,
                'group/heading hover:bg-neutral-50 dark:hover:bg-neutral-800/60',
              )}
            >
              {/* 「未分组」没有图标时直接左对齐，不制造一个看不见的空槽。 */}
              {section.group && <ModelGroupGlyph group={section.group} size="sm" />}
              <span className={HEADING_TEXT_CLASS}>{sectionName(section)}</span>
              <span className={HEADING_COUNT_CLASS}>{section.models.length}</span>
              {/* 折叠时若当前选中模型在组内，标题条给一个小圆点提示 */}
              {collapsed && containsActive && (
                <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
              )}
              {/* 折叠箭头占用操作列，与模型行的 ⓘ 同列 */}
              <span aria-hidden className={clsx(TRAILING_SLOT_CLASS, 'ml-auto')}>
                <ChevronDown
                  className={clsx(
                    'h-3.5 w-3.5 text-neutral-400 transition-transform duration-200 ease-out group-hover/heading:text-neutral-500 motion-reduce:transition-none dark:group-hover/heading:text-neutral-300',
                    collapsed && '-rotate-90',
                  )}
                />
              </span>
            </button>
            {/*
              0fr ⇄ 1fr 让内容按真实高度展开；折叠态 inert，避免不可见模型仍能被键盘聚焦。
              内层必须用 overflow-clip 而非 overflow-hidden：hidden 会把 Grid item 的横向自动最小尺寸降为 0，
              令外层 w-fit 面板忽略模型名与标签的固有宽度，最终把本来放得下的模型名截断。
            */}
            <div
              aria-hidden={collapsed}
              inert={collapsed ? true : undefined}
              className={clsx(
                'grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none',
                collapsed ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100',
              )}
            >
              <div className="min-h-0 overflow-clip">
                {section.models.map((model) => (
                  <ModelRow
                    key={model.id}
                    model={model}
                    selected={model.id === activeModelId}
                    onSelect={onSelectModel}
                    sheet={sheet}
                    descriptionOpen={sheet && openDescriptionId === model.id}
                    onToggleDescription={() =>
                      setOpenDescriptionId(openDescriptionId === model.id ? null : model.id)
                    }
                  />
                ))}
              </div>
            </div>
          </div>
        )
      })}
    </>
  )
}

/** 二级目录视图：一级选分组，点进去看该组模型。 */
function TreeList({
  sections,
  activeModelId,
  onSelectModel,
  sheet,
  openDescriptionId,
  setOpenDescriptionId,
  openedKey,
  onOpenSection,
}: ListProps & { openedKey: string | null; onOpenSection: (key: string | null) => void }) {
  const opened = sections.find((section) => sectionKey(section) === openedKey) ?? null
  const [navigationTransition, setNavigationTransition] = useState<{
    targetKey: string | null
    direction: 'deeper' | 'parent'
  } | null>(null)
  const transitionDirection =
    navigationTransition?.targetKey === openedKey ? navigationTransition.direction : null
  const levelAnimationClass =
    transitionDirection === 'deeper'
      ? 'hc-model-level-deeper-in'
      : transitionDirection === 'parent'
        ? 'hc-model-level-parent-in'
        : undefined

  const navigateTo = (targetKey: string | null, direction: 'deeper' | 'parent') => {
    // 记录目标而非只记方向：若分组数据刷新导致 openedKey 被外部校正，不应误播旧方向的动画。
    setNavigationTransition({ targetKey, direction })
    onOpenSection(targetKey)
  }

  if (!opened) {
    return (
      <div key="root" className={levelAnimationClass}>
        {sections.map((section) => {
          const containsActive = section.models.some((model) => model.id === activeModelId)
          return (
            <button
              key={sectionKey(section)}
              type="button"
              data-active={containsActive || undefined}
              onClick={() => navigateTo(sectionKey(section), 'deeper')}
              className={clsx(
                'flex w-full items-center gap-2 rounded-lg pl-3 pr-2 text-left text-sm transition hover:bg-neutral-100 dark:hover:bg-neutral-800',
                sheet ? 'py-2.5' : 'py-2',
              )}
            >
              {section.group && <ModelGroupGlyph group={section.group} size="sm" />}
              <span className="min-w-0 flex-1 truncate text-neutral-800 dark:text-neutral-100">
                {sectionName(section)}
              </span>
              {containsActive && (
                <span
                  aria-hidden
                  title="当前所用模型在此分组"
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500"
                />
              )}
              <span className="shrink-0 text-[11px] tabular-nums text-neutral-400 dark:text-neutral-500">
                {section.models.length}
              </span>
              {/* 钻取箭头占用操作列，与组内列表的 ⓘ 同列 */}
              <span aria-hidden className={TRAILING_SLOT_CLASS}>
                <ChevronRight className="h-3.5 w-3.5 text-neutral-400" />
              </span>
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div key={sectionKey(opened)} className={levelAnimationClass}>
      <button
        type="button"
        onClick={() => navigateTo(null, 'parent')}
        className={clsx(
          HEADING_BAR_CLASS,
          'mb-0.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/60',
        )}
      >
        {/* 返回箭头落在图标列、组名落在名称列，与下方模型行同列 */}
        <ChevronLeft aria-hidden className="h-4 w-4 shrink-0 text-neutral-400" />
        <span className={HEADING_TEXT_CLASS}>{sectionName(opened)}</span>
        <span className={HEADING_COUNT_CLASS}>{opened.models.length}</span>
      </button>
      {opened.models.map((model) => (
        <ModelRow
          key={model.id}
          model={model}
          selected={model.id === activeModelId}
          onSelect={onSelectModel}
          sheet={sheet}
          descriptionOpen={sheet && openDescriptionId === model.id}
          onToggleDescription={() =>
            setOpenDescriptionId(openDescriptionId === model.id ? null : model.id)
          }
        />
      ))}
    </div>
  )
}

/**
 * 模型列表分区：选择器里唯一允许内部滚动的部分。
 *
 * 两种视图共用同一份分区数据与同一个模型行组件，区别只在层级呈现方式：
 * - flat：一条列表，分组标题可折叠；
 * - tree：一级分组 → 二级模型的文件夹式钻取。
 * 搜索有输入时两者都退化为扁平结果，因为此时用户找的是具体模型而非结构。
 */
export function ModelListSection({
  models,
  groups,
  activeModelId,
  onSelectModel,
  sheet,
  view,
  viewToggle,
  modelParameterSections,
}: {
  models: ModelDTO[]
  groups: ModelGroupDTO[]
  activeModelId: string | null
  onSelectModel: (id: string) => void
  sheet: boolean
  view: ModelListView
  /** 视图切换控件，渲染在分区标题右侧 */
  viewToggle: React.ReactNode
  /** 当前模型的全部参数分区；二级目录根层会统一隐藏，进入分组后再显示。 */
  modelParameterSections: React.ReactNode
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const [openDescriptionId, setOpenDescriptionId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  // 搜索框默认收成一个图标：多数时候用户是来挑模型的，输入框常驻会把顶部压得很重。
  const [searchOpen, setSearchOpen] = useState(false)

  const allSections = useMemo(() => buildModelSections(models, groups), [models, groups])
  const sections = useMemo(() => filterModelSections(allSections, search), [allSections, search])
  const searching = search.trim().length > 0
  const grouped = hasGroupStructure(allSections)
  // 模型不多时搜索框纯属占地方，够多了才出现
  const showSearch = models.length > 8
  const effectiveView = resolveModelListView(view, allSections)

  // 二级目录：打开时直接定位到当前选中模型所在的分组，长列表不用逐级找。
  const [openedKey, setOpenedKey] = useState<string | null>(() =>
    findSectionKeyOfModel(allSections, activeModelId),
  )
  const previousViewRef = useRef<ModelListView>(effectiveView)
  const openedSectionExists =
    openedKey !== null && sections.some((section) => sectionKey(section) === openedKey)
  const showModelParameters = shouldShowModelParameters(
    effectiveView,
    searching,
    openedSectionExists,
  )

  useLayoutEffect(() => {
    const previousView = previousViewRef.current
    previousViewRef.current = effectiveView
    setOpenedKey((currentOpenedKey) =>
      openedSectionOnViewChange(
        previousView,
        effectiveView,
        currentOpenedKey,
        allSections,
        activeModelId,
      ),
    )
  }, [effectiveView, allSections, activeModelId])

  // 菜单打开即挂载本组件：首帧把选中模型滚进列表可视区。
  // 依赖 effectiveView/openedKey/search 是因为切换视图或钻取后可见内容整体换过，需要重新定位。
  useLayoutEffect(() => {
    listRef.current?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' })
  }, [effectiveView, openedKey, searching])

  // Escape 先收起搜索框、再交给菜单去关闭：捕获阶段抢在菜单那个 window 监听之前。
  useEffect(() => {
    if (!searchOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setSearch('')
      setSearchOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [searchOpen])

  return (
    <>
      <div
        className={clsx(
          'flex min-w-0 flex-col p-1.5 pb-1',
          // 参数区出现时保证模型列表仍有可操作空间；分组根层没有参数区，应按分组数量自然收高。
          showModelParameters && 'min-h-[9.5rem]',
        )}
      >
        {/*
          顶部工具栏：一条 28px 的窄带，左侧是分区名、右侧是「搜索 + 视图切换」两枚同规格图标控件。
          点搜索图标才就地展开输入框（顶掉分区名），避免常驻输入框把面板顶部压出第二条横带。
        */}
        <div className={clsx('mb-1.5 flex shrink-0 items-center gap-1.5', sheet ? 'h-8' : 'h-7')}>
          {searchOpen ? (
            <ModelSearchBox
              value={search}
              onChange={setSearch}
              onClose={() => {
                setSearch('')
                setSearchOpen(false)
              }}
              sheet={sheet}
            />
          ) : (
            <>
              <div className="min-w-0 flex-1 truncate pl-3 text-xs font-medium text-neutral-400 dark:text-neutral-500">
                模型
              </div>
              {showSearch && (
                <button
                  type="button"
                  onClick={() => setSearchOpen(true)}
                  aria-label="搜索模型"
                  title="搜索模型"
                  className={clsx(TOOLBAR_ICON_BUTTON_CLASS, sheet ? 'h-8 w-8' : 'h-7 w-7')}
                >
                  <Search aria-hidden className="h-4 w-4" />
                </button>
              )}
            </>
          )}
          {grouped && viewToggle}
        </div>
        <div
          ref={listRef}
          className="hc-scrollbar hc-size-transition-scroll-region min-h-0 flex-1 overflow-y-auto"
        >
          {sections.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-neutral-400 dark:text-neutral-500">
              没有匹配的模型
            </div>
          ) : effectiveView === 'tree' && !searching ? (
            <TreeList
              sections={sections}
              activeModelId={activeModelId}
              onSelectModel={onSelectModel}
              sheet={sheet}
              openDescriptionId={openDescriptionId}
              setOpenDescriptionId={setOpenDescriptionId}
              openedKey={openedKey}
              onOpenSection={setOpenedKey}
            />
          ) : (
            <FlatList
              sections={sections}
              activeModelId={activeModelId}
              onSelectModel={onSelectModel}
              sheet={sheet}
              openDescriptionId={openDescriptionId}
              setOpenDescriptionId={setOpenDescriptionId}
              // 搜索结果按扁平列表呈现：此时用户要的是具体模型，分组标题只会碍事。
              collapsible={!searching}
            />
          )}
        </div>
      </div>
      {showModelParameters && modelParameterSections}
    </>
  )
}
