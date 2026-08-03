import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'
import { Check, ChevronDown, ChevronLeft, ChevronRight, Info, Search, X } from 'lucide-react'
import type { ModelDTO, ModelGroupDTO } from '@shared/types/api'
import { ModelGroupGlyph, ModelIconMark } from '../components/ModelIcon'
import { ModelTagList } from '../components/ModelTags'
import { useModelPickerStore } from '../store/modelPicker'
import {
  buildModelSections,
  filterModelSections,
  findSectionKeyOfModel,
  flattenSections,
  hasGroupStructure,
  openedSectionOnViewChange,
  sectionKey,
  sectionName,
  type ModelListView,
  type ModelSection,
} from './modelGroups'

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

/** 单个模型行（两种视图共用）。 */
function ModelRow({
  model,
  selected,
  onSelect,
  sheet,
  descriptionOpen,
  onToggleDescription,
  indented,
}: {
  model: ModelDTO
  selected: boolean
  onSelect: (id: string) => void
  sheet: boolean
  descriptionOpen: boolean
  onToggleDescription: () => void
  /** 平铺视图里分组下的成员缩进，与分组标题形成层级 */
  indented?: boolean
}) {
  return (
    <div data-active={selected || undefined}>
      <div
        className={clsx(
          'flex items-center rounded-lg transition hover:bg-neutral-100 dark:hover:bg-neutral-800',
          selected && 'bg-neutral-100 dark:bg-neutral-800',
        )}
      >
        <button
          type="button"
          onClick={() => onSelect(model.id)}
          className={clsx(
            'flex min-w-0 flex-1 items-center gap-2 rounded-lg pr-3 text-left text-sm',
            indented ? 'pl-6' : 'pl-3',
            sheet ? 'py-2.5' : 'py-2',
          )}
        >
          <ModelIconMark
            icon={model.icon}
            modelId={model.modelId}
            displayName={model.displayName}
            size="sm"
            className="text-neutral-500 dark:text-neutral-400"
          />
          <span className="min-w-0 shrink truncate text-neutral-800 dark:text-neutral-100">
            {model.displayName}
          </span>
          <ModelTagList tags={model.tags} />
          {model.kind === 'image' && <span className="shrink-0 text-xs text-neutral-400">生图</span>}
          {selected && (
            <Check className="ml-auto h-4 w-4 shrink-0 text-neutral-500 dark:text-neutral-400" />
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
                'mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition',
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
        <div
          className={clsx(
            'pb-2 pr-3 pt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400',
            indented ? 'pl-6' : 'pl-3',
          )}
        >
          {model.description}
        </div>
      )}
    </div>
  )
}

/** 搜索框：两种视图共用，有输入时都退化为扁平结果列表。 */
function ModelSearchBox({
  value,
  onChange,
  sheet,
}: {
  value: string
  onChange: (value: string) => void
  sheet: boolean
}) {
  return (
    <div className="relative mb-1.5 shrink-0 px-1.5">
      <Search
        aria-hidden
        className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400 dark:text-neutral-500"
      />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="搜索模型"
        aria-label="搜索模型"
        className={clsx(
          'w-full rounded-lg border border-neutral-200 bg-white pl-8 pr-7 text-sm text-neutral-800 outline-none transition placeholder:text-neutral-400 focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:border-neutral-500',
          sheet ? 'h-9' : 'h-8',
        )}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="清空搜索"
          className="absolute right-3 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-neutral-400 transition hover:text-neutral-600 dark:hover:text-neutral-300"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
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
          <div key={key} data-active={collapsed && containsActive ? true : undefined}>
            <button
              type="button"
              onClick={() => toggleGroupCollapsed(key)}
              aria-expanded={!collapsed}
              className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <ChevronDown
                aria-hidden
                className={clsx(
                  'h-3 w-3 shrink-0 text-neutral-400 transition-transform',
                  collapsed && '-rotate-90',
                )}
              />
              {section.group && <ModelGroupGlyph group={section.group} size="xs" />}
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-neutral-500 dark:text-neutral-400">
                {sectionName(section)}
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-neutral-400 dark:text-neutral-500">
                {section.models.length}
              </span>
              {/* 折叠时若当前选中模型在组内，标题行给一个小圆点提示 */}
              {collapsed && containsActive && (
                <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
              )}
            </button>
            {!collapsed &&
              section.models.map((model) => (
                <ModelRow
                  key={model.id}
                  model={model}
                  selected={model.id === activeModelId}
                  onSelect={onSelectModel}
                  sheet={sheet}
                  indented
                  descriptionOpen={sheet && openDescriptionId === model.id}
                  onToggleDescription={() =>
                    setOpenDescriptionId(openDescriptionId === model.id ? null : model.id)
                  }
                />
              ))}
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

  if (!opened) {
    return (
      <>
        {sections.map((section) => {
          const containsActive = section.models.some((model) => model.id === activeModelId)
          return (
            <button
              key={sectionKey(section)}
              type="button"
              data-active={containsActive || undefined}
              onClick={() => onOpenSection(sectionKey(section))}
              className={clsx(
                'flex w-full items-center gap-2 rounded-lg px-3 text-left text-sm transition hover:bg-neutral-100 dark:hover:bg-neutral-800',
                sheet ? 'py-2.5' : 'py-2',
              )}
            >
              {section.group ? (
                <ModelGroupGlyph group={section.group} size="xs" />
              ) : (
                <span aria-hidden className="h-5 w-5 shrink-0" />
              )}
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
              <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
            </button>
          )
        })}
      </>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => onOpenSection(null)}
        className="mb-0.5 flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        <ChevronLeft aria-hidden className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-neutral-500 dark:text-neutral-400">
          {sectionName(opened)}
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-neutral-400 dark:text-neutral-500">
          {opened.models.length}
        </span>
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
    </>
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
}: {
  models: ModelDTO[]
  groups: ModelGroupDTO[]
  activeModelId: string | null
  onSelectModel: (id: string) => void
  sheet: boolean
  view: ModelListView
  /** 视图切换控件，渲染在分区标题右侧 */
  viewToggle: React.ReactNode
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const [openDescriptionId, setOpenDescriptionId] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const allSections = useMemo(() => buildModelSections(models, groups), [models, groups])
  const sections = useMemo(
    () => filterModelSections(allSections, search),
    [allSections, search],
  )
  const searching = search.trim().length > 0
  const grouped = hasGroupStructure(allSections)

  // 二级目录：打开时直接定位到当前选中模型所在的分组，长列表不用逐级找。
  const [openedKey, setOpenedKey] = useState<string | null>(() =>
    findSectionKeyOfModel(allSections, activeModelId),
  )
  const previousViewRef = useRef<ModelListView>(view)

  useLayoutEffect(() => {
    const previousView = previousViewRef.current
    previousViewRef.current = view
    setOpenedKey((currentOpenedKey) =>
      openedSectionOnViewChange(previousView, view, currentOpenedKey, allSections, activeModelId),
    )
  }, [view, allSections, activeModelId])

  // 菜单打开即挂载本组件：首帧把选中模型滚进列表可视区。
  // 依赖 view/openedKey/search 是因为切换视图或钻取后可见内容整体换过，需要重新定位。
  useLayoutEffect(() => {
    listRef.current?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' })
  }, [view, openedKey, searching])

  return (
    <div className="flex min-h-[9.5rem] min-w-0 flex-col p-1.5 pb-1">
      <div className="flex items-center justify-between gap-2 px-3 pb-1.5 pt-2">
        <div className="text-xs font-medium text-neutral-400 dark:text-neutral-500">模型</div>
        {grouped && viewToggle}
      </div>
      {/* 模型不多时搜索框纯属占地方，够多了才出现 */}
      {models.length > 8 && <ModelSearchBox value={search} onChange={setSearch} sheet={sheet} />}
      <div ref={listRef} className="hc-scrollbar min-h-0 flex-1 overflow-y-auto">
        {sections.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-neutral-400 dark:text-neutral-500">
            没有匹配的模型
          </div>
        ) : view === 'tree' && !searching ? (
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
  )
}
