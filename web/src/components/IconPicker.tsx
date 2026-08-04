import type { KeyboardEvent as ReactKeyboardEvent, ReactElement, ReactNode } from 'react'
import { Suspense, lazy, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { clsx } from 'clsx'
import {
  ChevronDown,
  ImagePlus,
  Loader2,
  RotateCcw,
  Search,
  Trash2,
  Type,
  Upload,
} from 'lucide-react'
import type { ModelIcon, ModelIconAsset } from '@shared/types/domain'
import { MAX_CUSTOM_ICON_BYTES } from '@shared/util/modelIcon'
import * as adminApi from '../api/admin'
import { useLobeIconCatalog } from '../hooks/useModels'
import { askConfirm } from '../store/confirm'
import { toast } from '../store/toast'
import { Field } from '../pages/admin/FormField'
import { DEFAULT_MODEL_ICON_TONE_CLASS, ModelIconMark } from './ModelIcon'
import { CURATED_ICON_SLUGS, ICON_SEARCH_RESULT_LIMIT } from './curatedIcons'
import { searchIconSlugs } from './iconSearch'

const EmojiPickerPanel = lazy(() => import('../chat/EmojiPickerPanel'))

type PickerTab = 'lobe' | 'custom' | 'emoji'

const TABS: readonly { value: PickerTab; label: string }[] = [
  { value: 'lobe', label: '内置图标' },
  { value: 'custom', label: '自定义' },
  { value: 'emoji', label: 'Emoji' },
]

const cellClass =
  'flex h-10 w-10 items-center justify-center justify-self-center rounded-lg border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400'
const cellIdleClass = clsx(
  'border-transparent hover:bg-neutral-100 dark:hover:bg-neutral-800',
  DEFAULT_MODEL_ICON_TONE_CLASS,
)
const cellSelectedClass =
  'border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-700 dark:bg-sky-950/50 dark:text-sky-200'
const iconGridClass =
  'hc-scrollbar grid max-h-40 grid-cols-6 justify-items-center gap-1 overflow-y-auto overscroll-contain pr-1 sm:grid-cols-7'

export interface IconPickerEmptyState {
  /** 实际会显示的回退图形；不传时使用通用图标占位。 */
  preview?: ReactNode
  title?: ReactNode
  description?: ReactNode
}

export interface IconPickerInitialOption {
  /** 使用首字母模式时的真实预览。 */
  preview: ReactNode
  /** 新建空草稿时禁用，避免选择一个没有字母可显示的状态。 */
  available?: boolean
  /** 自动识别成功时，在折叠摘要右侧直接提供“使用首字母”。 */
  showDefaultShortcut?: boolean
}

/** 内置图标网格：默认策展列表，有搜索词则从完整目录过滤（结果有数量上限）。 */
function LobeIconGrid({
  value,
  onChange,
  search,
  initialOption,
}: {
  value: ModelIcon | null
  onChange: (icon: ModelIcon) => void
  search: string
  initialOption?: IconPickerInitialOption
}) {
  const { data: catalog, isPending } = useLobeIconCatalog()

  const result = useMemo(() => {
    const keyword = search.trim()
    if (!keyword) return { slugs: [...CURATED_ICON_SLUGS], total: CURATED_ICON_SLUGS.length }
    if (!catalog) return { slugs: [], total: 0 }
    return searchIconSlugs(catalog.slugs, keyword, ICON_SEARCH_RESULT_LIMIT)
  }, [search, catalog])

  const { slugs, total } = result
  const searching = search.trim().length > 0
  const truncated = searching && total > slugs.length
  const initialAvailable = initialOption && initialOption.available !== false

  return (
    <div className="space-y-2">
      {initialAvailable && (
        <button
          type="button"
          onClick={() => onChange({ type: 'initial' })}
          aria-pressed={value?.type === 'initial'}
          className={clsx(
            'flex min-h-12 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400',
            value?.type === 'initial'
              ? cellSelectedClass
              : 'border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-neutral-600 dark:hover:bg-neutral-800/70',
          )}
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center">
            {initialOption.preview}
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-medium text-neutral-800 dark:text-neutral-100">
              名称首字母
            </span>
            <span className="mt-0.5 block text-[11px] leading-4 text-neutral-500 dark:text-neutral-400">
              跳过自动品牌识别，始终使用名称首字母
            </span>
          </span>
        </button>
      )}
      {searching && isPending ? (
        <div className="flex items-center justify-center py-6 text-xs text-neutral-400">
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          正在加载图标目录…
        </div>
      ) : slugs.length === 0 ? (
        <div className="py-6 text-center text-xs text-neutral-400">没有匹配的图标</div>
      ) : (
        <div className={iconGridClass}>
          {slugs.map((slug) => {
            const selected = value?.type === 'lobe' && value.slug === slug
            return (
              <button
                key={slug}
                type="button"
                onClick={() => onChange({ type: 'lobe', slug })}
                aria-pressed={selected}
                title={slug}
                className={clsx(cellClass, selected ? cellSelectedClass : cellIdleClass)}
              >
                <ModelIconMark icon={{ type: 'lobe', slug }} size="md" />
              </button>
            )
          })}
        </div>
      )}
      <p className="text-[11px] leading-4 text-neutral-400 dark:text-neutral-500">
        {searching
          ? truncated
            ? `共 ${total} 个匹配，仅展示前 ${ICON_SEARCH_RESULT_LIMIT} 个`
            : `共 ${total} 个匹配`
          : '支持中文、全拼或品牌英文名搜索全部内置图标'}
      </p>
    </div>
  )
}

/** 自定义图标库：上传一次，可被多个模型/分组引用。 */
export function CustomIconGrid({
  value,
  onChange,
}: {
  value: ModelIcon | null
  onChange: (icon: ModelIcon | null) => void
}) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const { data: icons, isPending } = useQuery({
    queryKey: ['admin', 'custom-icons'],
    queryFn: adminApi.listCustomIcons,
  })

  const upload = useMutation({
    mutationFn: ({ file, name }: { file: File; name: string }) =>
      adminApi.uploadCustomIcon(file, name),
    onSuccess: (icon) => {
      toast.success('已上传图标')
      void qc.invalidateQueries({ queryKey: ['admin', 'custom-icons'] })
      onChange({ type: 'custom', id: icon.id })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : '上传失败'),
  })

  const remove = useMutation({
    mutationFn: adminApi.deleteCustomIcon,
    onSuccess: (_result, deletedId) => {
      toast.success('已删除图标')
      void qc.invalidateQueries({ queryKey: ['admin', 'custom-icons'] })
      // 引用它的模型/分组已被服务端置空，两份列表都要刷新。
      void qc.invalidateQueries({ queryKey: ['admin', 'models'] })
      void qc.invalidateQueries({ queryKey: ['admin', 'model-groups'] })
      void qc.invalidateQueries({ queryKey: ['models'] })
      // 当前编辑草稿不会随 Query 缓存刷新；删的是当前值时要同步清空，避免保存后写回悬空 id。
      if (value?.type === 'custom' && value.id === deletedId) onChange(null)
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : '删除失败'),
  })

  const requestRemove = (icon: { id: string; name: string }) => {
    void askConfirm({
      title: '删除自定义图标？',
      description: `「${icon.name}」将从图标库移除，正在使用它的模型与分组会恢复为默认图标。`,
      confirmLabel: '删除',
      tone: 'danger',
    }).then((ok) => {
      if (ok) remove.mutate(icon.id)
    })
  }

  const onPick = (file: File | undefined) => {
    if (!file) return
    if (file.size > MAX_CUSTOM_ICON_BYTES) {
      toast.error('图标最大 1MB')
      return
    }
    upload.mutate({ file, name: file.name.replace(/\.[^.]+$/, '').slice(0, 40) || '自定义图标' })
  }
  const selectedCustomIcon =
    value?.type === 'custom' ? icons?.find((icon) => icon.id === value.id) : undefined

  return (
    <div className="space-y-2">
      <input
        ref={fileRef}
        type="file"
        accept="image/svg+xml,image/png,image/webp,image/jpeg,image/gif"
        className="hidden"
        onChange={(event) => {
          onPick(event.target.files?.[0])
          // 允许连续上传同一个文件（选同名文件不会再触发 change）。
          event.target.value = ''
        }}
      />
      {isPending ? (
        <div className="flex items-center justify-center py-6 text-xs text-neutral-400">
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          加载中…
        </div>
      ) : !icons?.length ? (
        <div className="py-5 text-center text-xs text-neutral-400">
          还没有自定义图标，上传后可在所有模型与分组间复用
        </div>
      ) : (
        <div className={iconGridClass}>
          {icons.map((icon) => {
            const selected = value?.type === 'custom' && value.id === icon.id
            return (
              <div key={icon.id} className="group/icon relative">
                <button
                  type="button"
                  onClick={() => onChange({ type: 'custom', id: icon.id })}
                  aria-pressed={selected}
                  title={icon.name}
                  className={clsx(
                    cellClass,
                    'w-full',
                    selected ? cellSelectedClass : cellIdleClass,
                  )}
                >
                  <ModelIconMark icon={{ type: 'custom', id: icon.id }} size="md" />
                </button>
                <button
                  type="button"
                  aria-label={`删除图标「${icon.name}」`}
                  onClick={() => requestRemove(icon)}
                  className="absolute -right-1 -top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-neutral-700 text-white shadow transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 sm:group-hover/icon:flex sm:group-focus-within/icon:flex dark:bg-neutral-200 dark:text-neutral-900"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            )
          })}
        </div>
      )}
      {selectedCustomIcon && (
        <button
          type="button"
          onClick={() => requestRemove(selectedCustomIcon)}
          className="flex h-10 w-full items-center justify-center gap-1.5 rounded-lg text-xs text-red-600 transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 sm:hidden dark:text-red-400 dark:hover:bg-red-950/30"
        >
          <Trash2 className="h-3.5 w-3.5" />
          删除当前图标「{selectedCustomIcon.name}」
        </button>
      )}
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={upload.isPending}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-neutral-300 py-2 text-xs text-neutral-500 transition hover:border-neutral-400 hover:text-neutral-700 disabled:opacity-60 dark:border-neutral-600 dark:text-neutral-400 dark:hover:border-neutral-500 dark:hover:text-neutral-200"
      >
        {upload.isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Upload className="h-3.5 w-3.5" />
        )}
        上传图标（SVG / PNG / WebP，最大 1MB）
      </button>
    </div>
  )
}

function selectedIconCopy(icon: ModelIcon): { title: string; description: string } {
  if (icon.type === 'lobe') {
    return { title: icon.slug, description: '内置品牌图标' }
  }
  if (icon.type === 'emoji') {
    return { title: 'Emoji 图标', description: icon.char }
  }
  if (icon.type === 'initial') {
    return { title: '名称首字母', description: '已关闭自动品牌识别' }
  }
  return { title: '自定义图标', description: '已从共享图标库选择' }
}

function PickerTabs({
  value,
  onChange,
  idBase,
  focusTarget,
  onFocusHandled,
}: {
  value: PickerTab
  onChange: (tab: PickerTab) => void
  idBase: string
  focusTarget: PickerTab | null
  onFocusHandled: () => void
}) {
  const activeTabRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (focusTarget !== value) return
    activeTabRef.current?.focus({ preventScroll: true })
    onFocusHandled()
  }, [focusTarget, onFocusHandled, value])

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + TABS.length) % TABS.length
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % TABS.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = TABS.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    onChange(TABS[nextIndex]!.value)
  }

  return (
    <div
      role="tablist"
      aria-label="图标来源"
      className="inline-flex shrink-0 self-start rounded-lg bg-neutral-200/60 p-0.5 sm:self-auto dark:bg-neutral-800"
    >
      {TABS.map((item, index) => {
        const selected = value === item.value
        return (
          <button
            key={item.value}
            ref={selected ? activeTabRef : undefined}
            id={`${idBase}-tab-${item.value}`}
            type="button"
            role="tab"
            tabIndex={selected ? 0 : -1}
            aria-selected={selected}
            aria-controls={`${idBase}-panel-${item.value}`}
            onClick={() => onChange(item.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={clsx(
              'h-7 rounded-md px-2.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400',
              selected
                ? 'bg-white text-neutral-800 shadow-sm dark:bg-neutral-600 dark:text-white'
                : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200',
            )}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

function EmojiPanelFallback() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-neutral-200/80 p-2.5 dark:border-neutral-800">
        <span className="h-8 w-52 animate-pulse rounded-lg bg-neutral-200/70 dark:bg-neutral-800" />
        <span className="hidden h-8 min-w-0 flex-1 animate-pulse rounded-lg bg-neutral-200/50 sm:block dark:bg-neutral-800/70" />
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center text-xs text-neutral-400">
        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
        表情加载中…
      </div>
    </div>
  )
}

interface IconPickerBaseProps {
  label?: string
  emptyState?: IconPickerEmptyState
}

interface IconPickerAssetProps extends IconPickerBaseProps {
  value: ModelIconAsset | null
  onChange: (icon: ModelIconAsset | null) => void
  initialOption?: never
}

interface IconPickerModelProps extends IconPickerBaseProps {
  value: ModelIcon | null
  onChange: (icon: ModelIcon | null) => void
  initialOption: IconPickerInitialOption
}

type IconPickerProps = IconPickerAssetProps | IconPickerModelProps

/**
 * 图标选择器：摘要字段负责展示当前有效外观与显式恢复默认，展开面板只负责选择来源。
 * 内置图标与 Emoji 的搜索都位于分页右侧；选择即时写入表单草稿，最终由宿主表单保存。
 */
export function IconPicker(props: IconPickerAssetProps): ReactElement
export function IconPicker(props: IconPickerModelProps): ReactElement
export function IconPicker({
  label = '图标（可选）',
  value,
  onChange,
  emptyState,
  initialOption,
}: IconPickerProps): ReactElement {
  const buttonId = useId()
  const descriptionId = useId()
  const panelId = useId()
  const tabsId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<PickerTab>('lobe')
  const [lobeSearch, setLobeSearch] = useState('')
  const [tabFocusTarget, setTabFocusTarget] = useState<PickerTab | null>(null)

  const initialAvailable = initialOption && initialOption.available !== false
  const selectedCopy = value ? selectedIconCopy(value) : null
  const showInitialShortcut =
    !value && Boolean(initialAvailable && initialOption.showDefaultShortcut)
  const activeTabId = `${tabsId}-tab-${tab}`
  const activeTabPanelId = `${tabsId}-panel-${tab}`

  const emitChange = (nextIcon: ModelIcon | null) => {
    // 模型分组等资源图标调用方没有 initialOption，运行时也拒绝意外写入首字母模式。
    if (nextIcon?.type === 'initial' && !initialOption) return
    ;(onChange as (icon: ModelIcon | null) => void)(nextIcon)
  }

  const changeTab = (nextTab: PickerTab) => {
    setTabFocusTarget(nextTab)
    setTab(nextTab)
  }

  const toggleOpen = () => {
    if (!open && value) {
      setTab(value.type === 'custom' || value.type === 'emoji' ? value.type : 'lobe')
    }
    setOpen((current) => !current)
  }

  const closePicker = () => {
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }))
  }

  const tabs = (
    <PickerTabs
      value={tab}
      onChange={changeTab}
      idBase={tabsId}
      focusTarget={tabFocusTarget}
      onFocusHandled={() => setTabFocusTarget(null)}
    />
  )

  return (
    <Field label={label} htmlFor={buttonId}>
      <div
        className={clsx(
          'flex min-h-16 overflow-hidden rounded-xl border bg-white transition focus-within:ring-2 dark:bg-neutral-900',
          open
            ? 'border-sky-300 ring-sky-100 dark:border-sky-700 dark:ring-sky-950/70'
            : 'border-neutral-200 focus-within:border-sky-300 focus-within:ring-sky-100 hover:border-neutral-300 dark:border-neutral-700 dark:focus-within:border-sky-700 dark:focus-within:ring-sky-950/70 dark:hover:border-neutral-600',
        )}
      >
        <button
          ref={triggerRef}
          id={buttonId}
          type="button"
          onClick={toggleOpen}
          aria-expanded={open}
          aria-controls={panelId}
          aria-describedby={descriptionId}
          className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left focus-visible:outline-none"
        >
          <span
            data-testid="icon-picker-preview"
            className="flex h-9 w-9 shrink-0 items-center justify-center text-neutral-400 dark:text-neutral-500"
          >
            {value?.type === 'initial' ? (
              initialOption?.preview
            ) : value ? (
              <ModelIconMark icon={value} size="lg" className={DEFAULT_MODEL_ICON_TONE_CLASS} />
            ) : (
              (emptyState?.preview ?? <ImagePlus className="h-5 w-5" strokeWidth={1.7} />)
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-neutral-800 dark:text-neutral-100">
              {selectedCopy?.title ?? emptyState?.title ?? '未设置图标'}
            </span>
            <span
              id={descriptionId}
              className="mt-0.5 block truncate text-xs text-neutral-500 dark:text-neutral-400"
            >
              {selectedCopy?.description ??
                emptyState?.description ??
                '选择内置图标、自定义上传或 Emoji'}
            </span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-neutral-400 dark:text-neutral-500">
            <span className="hidden sm:inline">{open ? '收起' : value ? '更换' : '选择'}</span>
            <ChevronDown
              aria-hidden
              className={clsx('h-4 w-4 transition-transform duration-200', open && 'rotate-180')}
              strokeWidth={1.8}
            />
          </span>
        </button>
        {(value || showInitialShortcut) && (
          <div className="flex shrink-0 items-center border-l border-neutral-200 px-1.5 dark:border-neutral-700">
            <button
              type="button"
              onClick={() => {
                emitChange(showInitialShortcut ? { type: 'initial' } : null)
                closePicker()
              }}
              aria-label={
                showInitialShortcut
                  ? '使用名称首字母图标'
                  : value?.type === 'initial'
                    ? '恢复自动识别图标'
                    : '恢复默认图标'
              }
              title={
                showInitialShortcut
                  ? '使用名称首字母图标'
                  : value?.type === 'initial'
                    ? '恢复自动识别图标'
                    : '恢复默认图标'
              }
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-2 text-xs text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            >
              {showInitialShortcut ? (
                <Type className="h-3.5 w-3.5" strokeWidth={1.8} />
              ) : (
                <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.8} />
              )}
              <span className="hidden sm:inline">
                {showInitialShortcut
                  ? '使用首字母'
                  : value?.type === 'initial'
                    ? '恢复自动'
                    : '恢复默认'}
              </span>
            </button>
          </div>
        )}
      </div>

      {open && (
        <div
          id={panelId}
          data-testid="icon-picker-panel"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            event.stopPropagation()
            closePicker()
          }}
          className="mt-2 overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900/60"
        >
          {tab === 'emoji' ? (
            <div className="h-64">
              <Suspense fallback={<EmojiPanelFallback />}>
                <EmojiPickerPanel
                  autoFocusSearch={false}
                  surface="muted"
                  toolbar={tabs}
                  panelId={activeTabPanelId}
                  panelLabelledBy={activeTabId}
                  onSelect={(char) => emitChange({ type: 'emoji', char })}
                />
              </Suspense>
            </div>
          ) : (
            <>
              <div className="flex shrink-0 flex-col gap-2 border-b border-neutral-200/80 p-2.5 sm:flex-row sm:items-center dark:border-neutral-800">
                {tabs}
                {tab === 'lobe' && (
                  <div className="relative min-w-0 flex-1">
                    <Search
                      aria-hidden
                      className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400"
                    />
                    <input
                      type="search"
                      value={lobeSearch}
                      onChange={(event) => setLobeSearch(event.target.value)}
                      placeholder="搜索品牌"
                      aria-label="搜索内置图标"
                      autoCapitalize="off"
                      autoComplete="off"
                      spellCheck={false}
                      className="h-8 w-full rounded-lg border border-neutral-200 bg-white pl-8 pr-2.5 text-[13px] text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-sky-300 focus:ring-2 focus:ring-sky-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-sky-700 dark:focus:ring-sky-950/70"
                    />
                  </div>
                )}
              </div>
              <div
                id={activeTabPanelId}
                role="tabpanel"
                aria-labelledby={activeTabId}
                className="p-2.5"
              >
                {tab === 'lobe' ? (
                  <LobeIconGrid
                    value={value}
                    onChange={emitChange}
                    search={lobeSearch}
                    initialOption={initialOption}
                  />
                ) : (
                  <CustomIconGrid value={value} onChange={emitChange} />
                )}
              </div>
            </>
          )}
        </div>
      )}
    </Field>
  )
}
