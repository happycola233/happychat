import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { clsx } from 'clsx'
import type {
  ExportAttachmentMode,
  ExportFormat,
  ExportOptions,
  ExportTimePrecision,
} from '@shared/schemas/export'
import { EXPORT_BATCH_MAX, EXPORT_FORMATS } from '@shared/schemas/export'
import { EXPORT_FORMAT_CAPS } from '@shared/util/exportOptions'
import { getConversation } from '../api/chat'
import {
  downloadBatchExport,
  downloadConversationExport,
  previewConversationExport,
  saveBlobToFile,
} from '../api/export'
import { Modal } from '../components/ui/Modal'
import { Button } from '../components/ui/Button'
import { Select } from '../components/ui/Select'
import { Toggle } from '../components/ui/Toggle'
import { Spinner } from '../components/ui/Spinner'
import { Checkbox } from '../components/ui/Checkbox'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { toast } from '../store/toast'
import { buildPath } from './buildPath'
import { textFromContent } from './contentText'
import { MessageSelectionPresets } from './MessageSelectionPresets'

function SectionTitle({ children, aside }: { children: string; aside?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <h4 className="text-[13px] font-semibold text-neutral-800 dark:text-neutral-100">
        {children}
      </h4>
      {aside}
    </div>
  )
}

/** 开关行：不支持当前格式时置灰并说明原因。 */
function OptionToggleRow({
  label,
  hint,
  disabled,
  checked,
  onChange,
}: {
  label: string
  hint?: string
  disabled?: boolean
  checked: boolean
  onChange: (v: boolean) => void
}) {
  const note = disabled ? '当前格式不支持' : hint
  return (
    <div
      className={clsx('flex items-center justify-between gap-4 py-2.5', disabled && 'opacity-50')}
    >
      <div className="min-w-0">
        <div className="text-sm text-neutral-800 dark:text-neutral-100">{label}</div>
        {note && <div className="mt-0.5 text-[12px] leading-5 text-neutral-400">{note}</div>}
      </div>
      <Toggle
        checked={checked && !disabled}
        onChange={onChange}
        disabled={disabled}
        ariaLabel={label}
      />
    </div>
  )
}

function SelectRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <span className="shrink-0 text-sm text-neutral-800 dark:text-neutral-100">{label}</span>
      {children}
    </div>
  )
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

const TIME_OPTIONS = [
  { value: 'second', label: '完整时间（到秒）' },
  { value: 'minute', label: '精确到分' },
  { value: 'day', label: '仅日期' },
  { value: 'none', label: '不显示时间' },
]

const ATTACHMENT_LABELS: Record<ExportAttachmentMode, string> = {
  embed: '包含附件文件',
  name: '仅保留文件名',
  omit: '不包含附件',
}

/**
 * 导出聊天弹窗：格式选择 + 内容选项 + 消息选择（单会话）+ 实时预览。
 * conversationIds 传多个即为批量导出（打包 ZIP / JSONL 合并单文件）。
 */
export function ExportDialog({
  conversationIds,
  onClose,
  onExported,
}: {
  conversationIds: string[]
  onClose: () => void
  onExported?: () => void
}) {
  const single = conversationIds.length === 1 ? conversationIds[0]! : null

  const { data: detail } = useQuery({
    queryKey: ['conversation', single],
    queryFn: () => getConversation(single!),
    enabled: Boolean(single),
  })
  const path = useMemo(
    () => (detail ? buildPath(detail.messages, detail.conversation.activeLeafId) : []),
    [detail],
  )

  const [format, setFormat] = useState<ExportFormat>('markdown')
  /** 打开弹窗时刻的纪元值：进入预览查询键，重开弹窗时不复用旧缓存（消息可能已更新） */
  const [previewEpoch] = useState(() => Date.now())
  /** 进行中的下载请求；弹窗关闭（卸载）时中止，避免「取消后仍自动下载」 */
  const downloadAbortRef = useRef<AbortController | null>(null)
  useEffect(() => () => downloadAbortRef.current?.abort(), [])
  const [scope, setScope] = useState<'active' | 'full'>('active')
  /** null = 全部消息（默认）；一旦手动改动则物化为集合 */
  const [selected, setSelected] = useState<ReadonlySet<string> | null>(null)
  const [includeReasoning, setIncludeReasoning] = useState(true)
  const [includeModel, setIncludeModel] = useState(true)
  const [includeCitations, setIncludeCitations] = useState(true)
  const [includeSearch, setIncludeSearch] = useState(true)
  const [includeUsage, setIncludeUsage] = useState(false)
  const [attachmentMode, setAttachmentMode] = useState<ExportAttachmentMode>('embed')
  const [timePrecision, setTimePrecision] = useState<ExportTimePrecision>('second')

  const caps = EXPORT_FORMAT_CAPS[format]
  const effectiveScope = caps.scopeFull ? scope : 'active'
  const selectionEnabled = Boolean(single) && effectiveScope === 'active'
  const selectedIds = useMemo(() => {
    if (!selectionEnabled || selected === null) return null
    return path.filter((m) => selected.has(m.id)).map((m) => m.id)
  }, [selectionEnabled, selected, path])
  const selectionEmpty = selectedIds !== null && selectedIds.length === 0
  const selectedSet = useMemo(
    () => selected ?? new Set(path.map((message) => message.id)),
    [selected, path],
  )

  const options: ExportOptions = useMemo(
    () => ({
      format,
      scope: effectiveScope,
      messageIds: selectedIds,
      includeReasoning,
      includeModel,
      includeCitations,
      includeSearch,
      includeUsage,
      attachmentMode: caps.attachmentModes.includes(attachmentMode)
        ? attachmentMode
        : caps.attachmentModes[0]!,
      timePrecision,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
    [
      format,
      effectiveScope,
      selectedIds,
      includeReasoning,
      includeModel,
      includeCitations,
      includeSearch,
      includeUsage,
      attachmentMode,
      timePrecision,
      caps,
    ],
  )

  // 预览请求防抖：以序列化选项为查询键，选项静止 350ms 后才发起
  const serializedOptions = JSON.stringify(options)
  const debouncedOptions = useDebouncedValue(serializedOptions, 350)
  // enabled 必须按「实际要发送的防抖后选项」判空，否则清空→重选的瞬间会用残留的空选择发出 400
  const debouncedSelectionEmpty = useMemo(() => {
    const o = JSON.parse(debouncedOptions) as ExportOptions
    return Array.isArray(o.messageIds) && o.messageIds.length === 0
  }, [debouncedOptions])
  const previewQuery = useQuery({
    queryKey: ['export-preview', single, previewEpoch, debouncedOptions],
    queryFn: () =>
      previewConversationExport(single!, JSON.parse(debouncedOptions) as ExportOptions),
    enabled: Boolean(single) && !selectionEmpty && !debouncedSelectionEmpty,
    placeholderData: (prev) => prev,
    staleTime: 30_000,
    retry: false,
  })
  const preview = previewQuery.data
  const previewStale = serializedOptions !== debouncedOptions || previewQuery.isFetching

  const download = useMutation({
    mutationFn: async () => {
      const controller = new AbortController()
      downloadAbortRef.current = controller
      if (single) return downloadConversationExport(single, options, controller.signal)
      return downloadBatchExport(conversationIds, options, controller.signal)
    },
    onSuccess: ({ blob, filename, exportedCount }) => {
      saveBlobToFile(blob, filename ?? `聊天导出.${caps.ext}`)
      if (single) {
        toast.success('已导出聊天')
      } else {
        // 服务端会跳过已被删除的会话，按实际导出数准确提示
        const actual = exportedCount ?? conversationIds.length
        if (actual < conversationIds.length) {
          toast.info(`已导出 ${actual} 个聊天，${conversationIds.length - actual} 个已不存在被跳过`)
        } else {
          toast.success(`已导出 ${actual} 个聊天`)
        }
      }
      onExported?.()
      onClose()
    },
    onError: (e) => {
      // 关闭弹窗中止请求属于用户主动取消，不提示错误
      if (e instanceof DOMException && e.name === 'AbortError') return
      toast.error(e instanceof Error ? e.message : '导出失败')
    },
  })

  // 服务端 schema 限制单次批量数量，前端提前禁用并提示分批，避免提交后才 400
  const batchOverLimit = conversationIds.length > EXPORT_BATCH_MAX

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev ?? path.map((m) => m.id))
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const replaceSelection = (ids: ReadonlySet<string>) => {
    const selectsEveryMessage =
      ids.size === path.length && path.every((message) => ids.has(message.id))
    setSelected(selectsEveryMessage ? null : new Set(ids))
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={single ? '导出聊天' : `批量导出 ${conversationIds.length} 个聊天`}
      size="form"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button
            loading={download.isPending}
            disabled={selectionEmpty || batchOverLimit}
            onClick={() => download.mutate()}
            data-testid="export-submit"
          >
            导出
          </Button>
        </>
      }
    >
      <div className="space-y-5" data-testid="export-dialog">
        {/* ---------------- 格式 ---------------- */}
        <section className="space-y-2">
          <SectionTitle>导出格式</SectionTitle>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="group" aria-label="导出格式">
            {EXPORT_FORMATS.map((f) => {
              const c = EXPORT_FORMAT_CAPS[f]
              const active = format === f
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFormat(f)}
                  aria-pressed={active}
                  data-testid={`export-format-${f}`}
                  data-selected={active}
                  className={clsx(
                    'rounded-xl border p-3 text-left transition select-none',
                    active
                      ? 'border-sky-400 bg-sky-500/5 dark:border-sky-500/60 dark:bg-sky-500/10'
                      : 'border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:border-neutral-600 dark:hover:bg-neutral-800/60',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={clsx(
                        'text-sm font-medium',
                        active
                          ? 'text-sky-700 dark:text-sky-300'
                          : 'text-neutral-800 dark:text-neutral-100',
                      )}
                    >
                      {c.label}
                    </span>
                    <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 font-mono text-[11px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                      .{c.ext}
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] leading-5 text-neutral-400">{c.description}</p>
                </button>
              )
            })}
          </div>
          {caps.specUrl && (
            <p className="text-[12px] leading-5 text-neutral-400">
              该格式遵循开放规范：
              <a
                href={caps.specUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-600 hover:underline dark:text-sky-400"
              >
                chatlog-md 格式规范 v1 ↗
              </a>
            </p>
          )}
        </section>

        {/* ---------------- 选项 ---------------- */}
        <section className="space-y-1">
          <SectionTitle>导出选项</SectionTitle>
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {caps.scopeFull && (
              <SelectRow label="消息范围">
                <Select
                  aria-label="消息范围"
                  value={effectiveScope}
                  onChange={(e) => setScope(e.target.value as 'active' | 'full')}
                  options={[
                    { value: 'active', label: '当前分支' },
                    { value: 'full', label: '全部分支（完整树）' },
                  ]}
                />
              </SelectRow>
            )}
            {caps.time && (
              <SelectRow label="时间显示">
                <Select
                  aria-label="时间显示精度"
                  value={timePrecision}
                  onChange={(e) => setTimePrecision(e.target.value as ExportTimePrecision)}
                  options={TIME_OPTIONS}
                />
              </SelectRow>
            )}
            <SelectRow label="附件">
              <Select
                aria-label="附件处理方式"
                value={
                  caps.attachmentModes.includes(attachmentMode)
                    ? attachmentMode
                    : caps.attachmentModes[0]!
                }
                onChange={(e) => setAttachmentMode(e.target.value as ExportAttachmentMode)}
                options={caps.attachmentModes.map((m) => ({
                  value: m,
                  label:
                    m === 'embed'
                      ? caps.embedVia === 'inline'
                        ? '内联进网页（单文件）'
                        : '包含附件文件（打包 ZIP）'
                      : ATTACHMENT_LABELS[m],
                }))}
              />
            </SelectRow>
            <OptionToggleRow
              label="思考摘要"
              hint="推理模型的思考过程摘要"
              disabled={!caps.reasoning}
              checked={includeReasoning}
              onChange={setIncludeReasoning}
            />
            <OptionToggleRow
              label="模型名称"
              hint="在助手消息上标注所用模型"
              disabled={!caps.model}
              checked={includeModel}
              onChange={setIncludeModel}
            />
            <OptionToggleRow
              label="引用来源"
              hint="联网 / X 搜索的参考链接列表"
              disabled={!caps.citations}
              checked={includeCitations}
              onChange={setIncludeCitations}
            />
            <OptionToggleRow
              label="检索过程"
              hint="联网搜索的搜索词与页面、X 搜索的站内检索"
              disabled={!caps.search}
              checked={includeSearch}
              onChange={setIncludeSearch}
            />
            <OptionToggleRow
              label="Token 用量统计"
              hint="每条回复的 Token 数与耗时"
              disabled={!caps.usage}
              checked={includeUsage}
              onChange={setIncludeUsage}
            />
          </div>
        </section>

        {/* ---------------- 消息选择（单会话 + 当前分支） ---------------- */}
        {selectionEnabled && path.length > 0 && (
          <section className="space-y-2.5">
            <SectionTitle
              aside={
                <span className="text-[12px] tabular-nums text-neutral-400">
                  已选 {selectedSet.size} / {path.length} 条
                </span>
              }
            >
              选择消息
            </SectionTitle>
            <MessageSelectionPresets
              messages={path}
              selectedIds={selectedSet}
              onChange={replaceSelection}
              testIdPrefix="export"
            />
            <div className="hc-scrollbar max-h-[min(240px,32vh)] overflow-y-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
              <div className="divide-y divide-neutral-100 dark:divide-neutral-800/80">
                {path.map((m) => {
                  const isSelected = selected === null || selected.has(m.id)
                  const text = textFromContent(m.content).trim() || '（附件消息）'
                  return (
                    <div
                      key={m.id}
                      role="button"
                      tabIndex={-1}
                      onClick={() => toggleOne(m.id)}
                      data-testid="export-message-row"
                      data-selected={isSelected}
                      className={clsx(
                        'flex cursor-pointer items-center gap-2.5 px-3 py-2 transition-colors',
                        isSelected
                          ? 'bg-white dark:bg-transparent'
                          : 'bg-neutral-50/60 dark:bg-neutral-900/40',
                        'hover:bg-neutral-100/70 dark:hover:bg-neutral-800/50',
                      )}
                    >
                      <span onClick={(e) => e.stopPropagation()} className="flex">
                        <Checkbox
                          checked={isSelected}
                          onChange={() => toggleOne(m.id)}
                          ariaLabel={m.role === 'user' ? '选择这条用户消息' : '选择这条 AI 回复'}
                        />
                      </span>
                      <span
                        className={clsx(
                          'flex h-5 w-8 shrink-0 items-center justify-center rounded-md text-[11px] font-medium',
                          m.role === 'user'
                            ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400'
                            : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400',
                        )}
                      >
                        {m.role === 'user' ? '你' : 'AI'}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-neutral-700 dark:text-neutral-200">
                        {text}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
            {selectionEmpty && (
              <p className="text-[12px] text-amber-600 dark:text-amber-400">请至少选择一条消息。</p>
            )}
          </section>
        )}

        {/* ---------------- 预览（单会话） ---------------- */}
        {single && (
          <section className="space-y-2">
            <SectionTitle
              aside={
                preview && (
                  <span className="max-w-[60%] truncate font-mono text-[11px] text-neutral-400">
                    {preview.filename}
                  </span>
                )
              }
            >
              预览
            </SectionTitle>
            {selectionEmpty ? (
              <p className="rounded-xl border border-neutral-200 px-3 py-6 text-center text-[12px] text-neutral-400 dark:border-neutral-800">
                请先选择要导出的消息
              </p>
            ) : preview ? (
              <div className="space-y-2">
                <pre
                  data-testid="export-preview"
                  className={clsx(
                    'hc-scrollbar max-h-56 overflow-auto whitespace-pre-wrap rounded-xl border border-neutral-200 bg-neutral-50/80 p-3 font-mono text-[11.5px] leading-relaxed text-neutral-700 transition-opacity dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-neutral-300',
                    previewStale && 'opacity-60',
                  )}
                >
                  {preview.preview}
                  {preview.truncated ? '\n…（预览已截断）' : ''}
                </pre>
                {preview.kind === 'zip' && preview.entries && (
                  <div className="flex flex-wrap gap-1.5">
                    {preview.entries.slice(0, 12).map((e) => (
                      <span
                        key={e.name}
                        className="rounded-md border border-neutral-200 px-1.5 py-0.5 font-mono text-[11px] text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
                      >
                        {e.name} · {formatBytes(e.size)}
                      </span>
                    ))}
                    {preview.entries.length > 12 && (
                      <span className="px-1 py-0.5 text-[11px] text-neutral-400">
                        …共 {preview.entries.length} 个文件
                      </span>
                    )}
                  </div>
                )}
              </div>
            ) : previewQuery.isError ? (
              <p className="rounded-xl border border-neutral-200 px-3 py-6 text-center text-[12px] text-neutral-400 dark:border-neutral-800">
                {previewQuery.error instanceof Error ? previewQuery.error.message : '预览加载失败'}
              </p>
            ) : (
              <div className="flex items-center justify-center rounded-xl border border-neutral-200 py-10 dark:border-neutral-800">
                <Spinner className="h-5 w-5 text-neutral-400" />
              </div>
            )}
          </section>
        )}

        {!single && (
          <p className="text-[12px] leading-5 text-neutral-400">
            {format === 'jsonl'
              ? `${conversationIds.length} 个聊天将合并为一个 .jsonl 文件（每行一个会话）。`
              : `${conversationIds.length} 个聊天将打包为一个 ZIP，每个会话独立文件夹。`}
          </p>
        )}
        {batchOverLimit && (
          <p className="text-[12px] leading-5 text-amber-600 dark:text-amber-400">
            单次最多批量导出 {EXPORT_BATCH_MAX} 个聊天，请减少选择后分批导出。
          </p>
        )}
      </div>
    </Modal>
  )
}
