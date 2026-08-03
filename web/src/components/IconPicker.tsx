import { Suspense, lazy, useId, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { Check, Loader2, Search, Trash2, Upload, X } from 'lucide-react'
import type { ModelIcon } from '@shared/types/domain'
import { MAX_CUSTOM_ICON_BYTES } from '@shared/util/modelIcon'
import * as adminApi from '../api/admin'
import { useLobeIconCatalog } from '../hooks/useModels'
import { askConfirm } from '../store/confirm'
import { toast } from '../store/toast'
import { Field } from '../pages/admin/FormField'
import { ModelIconMark } from './ModelIcon'
import { CURATED_ICON_SLUGS, ICON_SEARCH_RESULT_LIMIT } from './curatedIcons'

const EmojiPickerPanel = lazy(() => import('../chat/EmojiPickerPanel'))

type PickerTab = 'lobe' | 'custom' | 'emoji'

const TABS: { value: PickerTab; label: string }[] = [
  { value: 'lobe', label: '内置图标' },
  { value: 'custom', label: '自定义' },
  { value: 'emoji', label: 'Emoji' },
]

const cellClass =
  'flex h-9 w-9 items-center justify-center rounded-lg border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400'
const cellIdleClass =
  'border-transparent text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
const cellSelectedClass =
  'border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-700 dark:bg-sky-950/50 dark:text-sky-200'

function sameIcon(left: ModelIcon | null, right: ModelIcon | null): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
}

/** 内置图标网格：默认策展列表，有搜索词则从完整目录过滤（结果有数量上限）。 */
function LobeIconGrid({
  value,
  onChange,
}: {
  value: ModelIcon | null
  onChange: (icon: ModelIcon) => void
}) {
  const [search, setSearch] = useState('')
  const { data: catalog, isPending } = useLobeIconCatalog()

  const slugs = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (!keyword) return CURATED_ICON_SLUGS
    if (!catalog) return []
    const matched: string[] = []
    for (const slug of catalog.slugs) {
      if (slug.includes(keyword)) {
        matched.push(slug)
        if (matched.length >= ICON_SEARCH_RESULT_LIMIT) break
      }
    }
    return matched.sort()
  }, [search, catalog])

  const searching = search.trim().length > 0
  const truncated = searching && slugs.length >= ICON_SEARCH_RESULT_LIMIT

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400"
        />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索品牌，如 openai / claude / flux"
          aria-label="搜索内置图标"
          className="h-8 w-full rounded-lg border border-neutral-200 bg-white pl-8 pr-2 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-500"
        />
      </div>
      {searching && isPending ? (
        <div className="flex items-center justify-center py-6 text-xs text-neutral-400">
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          正在加载图标目录…
        </div>
      ) : slugs.length === 0 ? (
        <div className="py-6 text-center text-xs text-neutral-400">没有匹配的图标</div>
      ) : (
        <div className="grid max-h-56 grid-cols-7 gap-1 overflow-y-auto">
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
            ? `匹配较多，仅展示前 ${ICON_SEARCH_RESULT_LIMIT} 个，请输入更精确的关键词`
            : `共 ${slugs.length} 个匹配`
          : '默认展示常用品牌，搜索可查找全部内置图标'}
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
        <div className="grid max-h-56 grid-cols-7 gap-1 overflow-y-auto">
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

/**
 * 图标选择器：内置库 / 自定义上传 / Emoji 三种来源收敛到一个控件，
 * 顶部预览按钮展示当前效果（与用户端渲染同一个组件，所见即所得）。
 */
export function IconPicker({
  label = '图标（可选）',
  value,
  onChange,
  /** 未设置图标时的说明，例如「自动识别：<预览>」 */
  emptyHint,
}: {
  label?: string
  value: ModelIcon | null
  onChange: (icon: ModelIcon | null) => void
  emptyHint?: React.ReactNode
}) {
  const buttonId = useId()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<PickerTab>('lobe')

  const select = (icon: ModelIcon) => {
    // 再点一次已选中的图标＝取消选择，省掉一个额外的「清除」动线。
    onChange(sameIcon(icon, value) ? null : icon)
  }

  return (
    <Field label={label} htmlFor={buttonId}>
      <div className="flex items-center gap-2">
        <button
          id={buttonId}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={clsx(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition',
            open
              ? 'border-sky-300 bg-sky-50 dark:border-sky-700 dark:bg-sky-950/40'
              : 'border-neutral-200 bg-white hover:border-neutral-300 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-neutral-600',
          )}
        >
          {value ? (
            <ModelIconMark
              icon={value}
              size="lg"
              className="text-neutral-700 dark:text-neutral-200"
            />
          ) : (
            <span className="text-[11px] text-neutral-400">未设置</span>
          )}
        </button>
        <div className="min-w-0 flex-1 text-xs text-neutral-500 dark:text-neutral-400">
          {value ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="truncate">
                {value.type === 'lobe'
                  ? `内置 · ${value.slug}`
                  : value.type === 'emoji'
                    ? `Emoji · ${value.char}`
                    : '自定义图标'}
              </span>
              <button
                type="button"
                onClick={() => onChange(null)}
                className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
              >
                <X className="h-3 w-3" />
                清除
              </button>
            </span>
          ) : (
            (emptyHint ?? '未设置图标')
          )}
        </div>
      </div>

      {open && (
        <div
          data-testid="icon-picker-panel"
          className="mt-2 rounded-xl border border-neutral-200 bg-neutral-50 p-2.5 dark:border-neutral-700 dark:bg-neutral-900/60"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="inline-flex rounded-lg bg-neutral-200/60 p-0.5 dark:bg-neutral-800">
              {TABS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setTab(item.value)}
                  aria-pressed={tab === item.value}
                  className={clsx(
                    'rounded-md px-2.5 py-1 text-xs font-medium transition',
                    tab === item.value
                      ? 'bg-white text-neutral-800 shadow-sm dark:bg-neutral-600 dark:text-white'
                      : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200',
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="收起图标选择"
              className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 transition hover:bg-neutral-200/60 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
          </div>

          {tab === 'lobe' && <LobeIconGrid value={value} onChange={select} />}
          {tab === 'custom' && (
            <CustomIconGrid
              value={value}
              onChange={(icon) => (icon ? select(icon) : onChange(null))}
            />
          )}
          {tab === 'emoji' && (
            <div className="h-56">
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center text-xs text-neutral-400">
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    加载中…
                  </div>
                }
              >
                <EmojiPickerPanel
                  autoFocusSearch={false}
                  surface="muted"
                  onSelect={(char) => select({ type: 'emoji', char })}
                />
              </Suspense>
            </div>
          )}
        </div>
      )}
    </Field>
  )
}
