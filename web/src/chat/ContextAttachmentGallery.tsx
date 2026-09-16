import { useState } from 'react'
import { FileText, ImageOff, Images, RotateCcw, Search, ZoomIn } from 'lucide-react'
import { clsx } from 'clsx'
import type { ContextAttachmentSelection } from '@shared/types/context'
import { attachmentUrl } from '../api/attachments'
import { Checkbox } from '../components/ui/Checkbox'
import { HighlightedText } from '../components/ui/HighlightedText'
import { ImagePreviewTrigger } from './ImagePreview'
import { fileTypeLabel, formatByteSize } from './uploadDraft'
import type { ContextAttachmentItem } from './contextAttachments'

type Filter = 'all' | 'images' | 'files' | 'generated'

export function ContextAttachmentGallery({
  items,
  selectedIds,
  selection,
  onSelect,
  onReset,
  loading,
  loadError,
  onRetry,
  canImage,
  canFile,
}: {
  items: ContextAttachmentItem[]
  selectedIds: Set<string>
  selection: ContextAttachmentSelection
  onSelect: (ids: string[], checked: boolean) => void
  onReset: (ids?: string[]) => void
  loading: boolean
  loadError: boolean
  onRetry: () => void
  canImage: boolean
  canFile: boolean
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [selectedOnly, setSelectedOnly] = useState(false)
  const included = new Set(selection.include)
  const excluded = new Set(selection.exclude)
  const matchesKind = (item: ContextAttachmentItem, kind: Filter) =>
    kind === 'all' ||
    (kind === 'files'
      ? item.part.type === 'input_file'
      : kind === 'generated'
        ? item.source === 'generatedImages'
        : item.part.type !== 'input_file' && item.source === 'uploads')
  const filtered = items.filter(
    (item) =>
      matchesKind(item, filter) &&
      (!selectedOnly || selectedIds.has(item.id)) &&
      `${item.filename} ${item.prompt}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  )
  const groups = new Map<string, ContextAttachmentItem[]>()
  for (const item of filtered) {
    const group = groups.get(item.groupId) ?? []
    group.push(item)
    groups.set(item.groupId, group)
  }
  const supported = (item: ContextAttachmentItem) =>
    item.part.type === 'input_file' ? canFile : canImage
  const selectable = (item: ContextAttachmentItem) => item.metadata?.available && supported(item)
  const selectGroup = (group: ContextAttachmentItem[], checked: boolean) =>
    onSelect(
      group.filter((item) => !checked || selectable(item)).map((item) => item.id),
      checked,
    )
  const modifiedCount = included.size + excluded.size

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-3 border-b border-neutral-100 px-5 pb-4 pt-5 dark:border-neutral-800">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              下次携带的附件
            </h4>
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              勾选可单独选回旧附件，取消勾选只影响下一次发送。
            </p>
          </div>
          {modifiedCount > 0 && (
            <button
              type="button"
              title="清除所有手动调整，按保留规则重新选择"
              onClick={() => onReset()}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-sky-600 hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-sky-950/40"
            >
              <RotateCcw className="h-3 w-3" />
              全部恢复自动
            </button>
          )}
        </div>
        <label className="flex h-9 items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50/50 px-3 focus-within:border-sky-400 dark:border-neutral-700 dark:bg-neutral-950/30">
          <Search className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
          <input
            type="search"
            aria-label="搜索聊天附件"
            placeholder="搜索文件名或消息内容"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full min-w-0 bg-transparent text-xs text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100"
          />
        </label>
        <div className="flex flex-wrap items-center gap-1.5" aria-label="附件类型">
          {(
            [
              { key: 'all', label: '全部' },
              { key: 'images', label: '上传图片' },
              { key: 'files', label: '文件' },
              { key: 'generated', label: '生成图' },
            ] as const
          ).map(({ key, label }) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
              className={clsx(
                'rounded-lg px-2.5 py-1.5 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500',
                filter === key
                  ? 'bg-sky-100/80 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300'
                  : 'text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800',
              )}
            >
              {label}
              <span className="ml-1.5 opacity-60">
                {items.filter((item) => matchesKind(item, key)).length}
              </span>
            </button>
          ))}
          <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
            <Checkbox checked={selectedOnly} onChange={setSelectedOnly} />
            只看已选
          </label>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-neutral-500 dark:text-neutral-400">
          <button
            type="button"
            disabled={loading || filtered.length === 0}
            onClick={() => selectGroup(filtered, true)}
            className="hover:text-sky-600 disabled:opacity-40 dark:hover:text-sky-400"
          >
            全选{query || filter !== 'all' || selectedOnly ? '结果' : ''}
          </button>
          <button
            type="button"
            disabled={loading || filtered.length === 0}
            onClick={() => selectGroup(filtered, false)}
            className="hover:text-sky-600 disabled:opacity-40 dark:hover:text-sky-400"
          >
            全部取消{query || filter !== 'all' || selectedOnly ? '（当前结果）' : ''}
          </button>
          <span className="ml-auto">
            {modifiedCount > 0 ? `${modifiedCount} 项手动调整` : '跟随保留规则'}
          </span>
        </div>
      </div>

      <div className="hc-scrollbar min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        {loadError ? (
          <div
            role="alert"
            className="py-10 text-center text-sm text-neutral-500 dark:text-neutral-400"
          >
            附件清单加载失败
            <button type="button" onClick={onRetry} className="ml-2 text-sky-600 dark:text-sky-400">
              重新加载
            </button>
          </div>
        ) : loading ? (
          <div
            role="status"
            className="grid grid-cols-2 gap-3 py-5 sm:grid-cols-3"
            aria-label="正在加载附件"
          >
            {[0, 1, 2, 3, 4, 5].map((key) => (
              <div
                key={key}
                className="h-40 animate-pulse rounded-xl bg-neutral-100 motion-reduce:animate-none dark:bg-neutral-800"
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex min-h-56 flex-col items-center justify-center gap-2 text-center">
            <div className="mb-1 rounded-2xl bg-neutral-100 p-4 dark:bg-neutral-800">
              <Images className="h-6 w-6 text-neutral-400" />
            </div>
            <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
              {items.length === 0
                ? '这个聊天还没有附件'
                : selectedOnly
                  ? '当前没有选中的附件'
                  : '没有找到匹配的附件'}
            </p>
            <p className="max-w-64 text-xs leading-relaxed text-neutral-400">
              {items.length === 0
                ? '上传文件或生成图片后，可以在这里挑选下次需要携带的内容。'
                : '试试其他筛选条件，或调整保留规则。'}
            </p>
          </div>
        ) : (
          [...groups.entries()].map(([groupId, group]) => {
            const first = group[0]!
            const checkedCount = group.filter((item) => selectedIds.has(item.id)).length
            const allChecked = checkedCount === group.length
            const groupLabel = first.currentBranch ? `第 ${first.turn} 轮` : '其他分支'
            const date = new Intl.DateTimeFormat('zh-CN', {
              month: 'numeric',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            }).format(first.createdAt)
            return (
              <section key={groupId} className="pt-5" aria-label={`${groupLabel}附件`}>
                <div className="mb-3 flex items-start gap-2.5">
                  <div className="pt-0.5">
                    <Checkbox
                      checked={allChecked}
                      indeterminate={checkedCount > 0 && !allChecked}
                      disabled={!allChecked && !group.some(selectable)}
                      ariaLabel={`选择${groupLabel}整组附件`}
                      onChange={(checked) => selectGroup(group, checked)}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-xs">
                      <span
                        className={clsx(
                          'font-medium',
                          first.currentBranch
                            ? 'text-neutral-700 dark:text-neutral-300'
                            : 'text-amber-600 dark:text-amber-400',
                        )}
                      >
                        {groupLabel}
                      </span>
                      <span className="text-[11px] text-neutral-400">{date}</span>
                      <span className="ml-auto tabular-nums text-neutral-400">
                        {checkedCount} / {group.length}
                      </span>
                    </div>
                    <p
                      title={first.prompt}
                      className="mt-1 truncate text-xs text-neutral-500 dark:text-neutral-400"
                    >
                      <HighlightedText text={first.prompt || '未附文字说明'} query={query} />
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                  {group.map((item) => {
                    const checked = selectedIds.has(item.id)
                    const modified = included.has(item.id) || excluded.has(item.id)
                    const available = item.metadata?.available
                    const canSelect = Boolean(selectable(item))
                    const isFile = item.part.type === 'input_file'
                    const status = !available
                      ? '文件已不可用'
                      : !supported(item)
                        ? '当前模型不支持'
                        : included.has(item.id)
                          ? '手动选中'
                          : excluded.has(item.id)
                            ? '本次排除'
                            : checked
                              ? '自动携带'
                              : item.currentBranch
                                ? '规则已省略'
                                : '未选中'
                    return (
                      <div
                        key={item.id}
                        data-attachment-id={item.id}
                        className={clsx(
                          'group relative min-w-0 overflow-hidden rounded-xl border transition',
                          checked
                            ? 'border-sky-400 bg-sky-50/40 shadow-[0_0_0_1px_rgb(56_189_248/0.12)] dark:border-sky-600 dark:bg-sky-950/20'
                            : 'border-neutral-200 bg-white hover:border-neutral-300 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-neutral-600',
                        )}
                      >
                        <label
                          className={clsx(
                            'block',
                            canSelect || checked ? 'cursor-pointer' : 'cursor-not-allowed',
                          )}
                        >
                          <div className="absolute left-2.5 top-2.5 z-10">
                            <Checkbox
                              variant={isFile ? 'default' : 'overlay'}
                              className="!h-5 !w-5"
                              checked={checked}
                              disabled={!canSelect && !checked}
                              ariaLabel={`携带 ${item.filename}`}
                              onChange={(value) => onSelect([item.id], value)}
                            />
                          </div>
                          <div className="flex h-28 items-center justify-center overflow-hidden bg-neutral-100/70 dark:bg-neutral-800/60">
                            {!available ? (
                              <ImageOff className="h-7 w-7 text-neutral-300 dark:text-neutral-600" />
                            ) : isFile ? (
                              <div className="flex flex-col items-center gap-2">
                                <FileText className="h-9 w-9 text-sky-500/80 dark:text-sky-400/80" />
                                <span className="text-[10px] font-semibold tracking-wider text-neutral-400">
                                  {fileTypeLabel(item.filename, item.metadata?.mime ?? null)}
                                </span>
                              </div>
                            ) : (
                              <img
                                src={attachmentUrl(item.id)}
                                alt={item.filename}
                                loading="lazy"
                                className="h-full w-full object-cover"
                              />
                            )}
                          </div>
                          <div className="px-2.5 pb-2.5 pt-2">
                            <p
                              title={item.filename}
                              className={clsx(
                                'text-xs font-medium text-neutral-800 dark:text-neutral-200',
                                query.trim() ? 'break-all' : 'truncate',
                              )}
                            >
                              <HighlightedText text={item.filename} query={query} />
                            </p>
                            <p className="mt-1 truncate text-[10px] text-neutral-400">
                              {item.source === 'generatedImages'
                                ? '模型生成'
                                : isFile
                                  ? '上传文件'
                                  : '上传图片'}
                              {item.metadata?.byteSize != null &&
                                ` · ${formatByteSize(item.metadata.byteSize)}`}
                            </p>
                            <p
                              className={clsx(
                                'mt-2 text-[10px]',
                                !available || !supported(item)
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : checked
                                    ? 'text-sky-600 dark:text-sky-400'
                                    : 'text-neutral-400',
                              )}
                            >
                              {status}
                            </p>
                          </div>
                        </label>
                        {available && !isFile && (
                          <div className="absolute right-2 top-2 z-10">
                            <ImagePreviewTrigger
                              src={attachmentUrl(item.id)}
                              alt={item.filename}
                              className="!rounded-md !bg-black/40 !p-1.5 text-white backdrop-blur-sm hover:!bg-black/60"
                            >
                              <ZoomIn className="h-3.5 w-3.5" />
                            </ImagePreviewTrigger>
                          </div>
                        )}
                        {available && isFile && (
                          <a
                            href={attachmentUrl(item.id)}
                            target="_blank"
                            rel="noreferrer"
                            title={`打开 ${item.filename}`}
                            aria-label={`打开 ${item.filename}`}
                            className="absolute right-2 top-2 rounded-md bg-white/90 p-1.5 text-neutral-500 hover:text-sky-600 dark:bg-neutral-900/90 dark:text-neutral-400"
                          >
                            <ZoomIn className="h-3.5 w-3.5" />
                          </a>
                        )}
                        {modified && (
                          <button
                            type="button"
                            aria-label={`恢复 ${item.filename} 自动选择`}
                            title="仅此附件恢复自动选择"
                            onClick={() => onReset([item.id])}
                            className="absolute bottom-2 right-2 flex items-center gap-1 rounded p-1 text-[10px] text-neutral-400 hover:bg-neutral-100 hover:text-sky-600 dark:hover:bg-neutral-800 dark:hover:text-sky-400"
                          >
                            <RotateCcw className="h-3 w-3" />
                            自动
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            )
          })
        )}
      </div>
    </div>
  )
}
