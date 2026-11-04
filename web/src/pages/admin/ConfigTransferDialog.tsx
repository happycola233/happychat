import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Bot, Download, FileUp, Upload } from 'lucide-react'
import { clsx } from 'clsx'
import type { ConfigImportAction, ConfigImportPreviewDTO } from '@shared/types/api'
import { Badge, type BadgeTone } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { inputClass } from '../../components/ui/controlStyles'
import { toast } from '../../store/toast'
import type { ConfigTransferKind } from './configTransferKinds'

const ACTION_LABELS: Record<ConfigImportAction, { label: string; tone: BadgeTone }> = {
  create: { label: '新建', tone: 'info' },
  update: { label: '更新', tone: 'success' },
  unchanged: { label: '无变化', tone: 'neutral' },
  error: { label: '有问题', tone: 'danger' },
}

export interface TransferScope {
  key: string
  label: string
  /** undefined=全部。 */
  ids?: string[]
}

function downloadJson(content: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

async function copyText(text: string, success: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(success)
  } catch {
    toast.error('复制失败，请改用下载')
  }
}

function ImportPreview({ preview }: { preview: ConfigImportPreviewDTO }) {
  if (preview.documentErrors.length > 0)
    return (
      <ul className="space-y-1 rounded-lg bg-red-50 p-3 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">
        {preview.documentErrors.map((error) => (
          <li key={error}>{error}</li>
        ))}
      </ul>
    )
  const { summary } = preview
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-xs">
        {(Object.keys(ACTION_LABELS) as ConfigImportAction[])
          .filter((action) => summary[action] > 0)
          .map((action) => (
            <Badge key={action} tone={ACTION_LABELS[action].tone}>
              {ACTION_LABELS[action].label} {summary[action]}
            </Badge>
          ))}
        {preview.notices.map((notice) => (
          <Badge key={notice} tone="info">
            {notice}
          </Badge>
        ))}
      </div>
      <ol className="divide-y divide-neutral-100 rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-700">
        {preview.items.map((item) => (
          <li key={item.index} className="space-y-1.5 px-3 py-2.5 text-sm">
            <div className="flex min-w-0 items-center gap-2">
              <Badge tone={ACTION_LABELS[item.action].tone}>
                {ACTION_LABELS[item.action].label}
              </Badge>
              <span className="min-w-0 truncate font-medium text-neutral-800 dark:text-neutral-100">
                {item.label}
              </span>
              <span className="ml-auto shrink-0 text-xs tabular-nums text-neutral-400">
                #{item.index + 1}
              </span>
            </div>
            {item.action === 'update' && (
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                将修改：{item.changes.join('、')}
              </p>
            )}
            {item.notes.map((note) => (
              <p key={note} className="text-xs text-amber-700 dark:text-amber-300">
                {note}
              </p>
            ))}
            {item.errors.map((error) => (
              <p key={error} className="break-words text-xs text-red-600 dark:text-red-400">
                {error}
              </p>
            ))}
          </li>
        ))}
      </ol>
    </div>
  )
}

/**
 * 配置的 JSON 导入导出（模型配置、额度策略共用）。导入先完整预览差异，
 * 确认后在一个事务内生效，任一条有问题则整份不生效。
 */
export function ConfigTransferDialog({
  kind,
  scopes,
  onClose,
}: {
  kind: ConfigTransferKind
  scopes: TransferScope[]
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'export' | 'import'>('export')
  const [scopeKey, setScopeKey] = useState(scopes[0]!.key)
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<ConfigImportPreviewDTO | null>(null)
  // 预览对应的文本；文本被修改后必须重新预览才能应用。
  const [previewedText, setPreviewedText] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const scope = scopes.find((item) => item.key === scopeKey) ?? scopes[0]!

  const exportDocument = async () => JSON.stringify(await kind.exportDocument(scope.ids), null, 2)
  const exporting = useMutation({
    mutationFn: async (target: 'download' | 'copy' | 'ai') => {
      const content = await exportDocument()
      if (target === 'download')
        downloadJson(content, `${kind.filePrefix}-${new Date().toISOString().slice(0, 10)}.json`)
      else if (target === 'copy') await copyText(content, '已复制配置 JSON')
      else
        await copyText(
          `${kind.aiGuide}\n\n下面是当前配置，请在此基础上按我的要求修改，只保留需要变化的${kind.noun}与字段：\n\n${content}`,
          '已复制说明与当前配置，可直接粘贴给 AI',
        )
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : '导出失败'),
  })

  const parseText = (): unknown => {
    try {
      return JSON.parse(text)
    } catch {
      throw new Error('不是有效的 JSON，请检查括号、引号与逗号')
    }
  }
  const previewing = useMutation({
    mutationFn: () => kind.previewImport(parseText()),
    onSuccess: (result) => {
      setPreview(result)
      setPreviewedText(text)
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : '预览失败'),
  })
  const applying = useMutation({
    mutationFn: () => kind.applyImport(parseText()),
    onSuccess: (result) => {
      const changed = result.summary.create + result.summary.update
      toast.success(changed ? `已导入，${changed} 个${kind.noun}发生变化` : '配置没有变化')
      for (const key of kind.invalidateKeys) void qc.invalidateQueries({ queryKey: key })
      onClose()
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '导入失败')
      // 应用期间配置可能已被他人修改，重新预览让管理员看到最新问题。
      previewing.mutate()
    },
  })
  const stale = preview !== null && previewedText !== text
  const changes = preview ? preview.summary.create + preview.summary.update : 0

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!applying.isPending}
      title={kind.title}
      size="workspace"
      height="workspace"
      navigation={
        <SegmentedControl
          label="导入或导出"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'export', label: '导出' },
            { value: 'import', label: '导入' },
          ]}
        />
      }
      footer={
        tab === 'import' ? (
          <>
            <Button variant="secondary" onClick={onClose} disabled={applying.isPending}>
              取消
            </Button>
            <Button
              variant="secondary"
              onClick={() => previewing.mutate()}
              loading={previewing.isPending}
              disabled={!text.trim() || applying.isPending}
            >
              预览变更
            </Button>
            <Button
              onClick={() => applying.mutate()}
              loading={applying.isPending}
              disabled={!preview?.valid || stale || changes === 0}
            >
              {changes > 0 ? `应用 ${changes} 项变更` : '应用'}
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            关闭
          </Button>
        )
      }
    >
      {tab === 'export' ? (
        <div className="space-y-5">
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium text-neutral-700 dark:text-neutral-200">
              导出范围
            </legend>
            {scopes.map((item) => (
              <label key={item.key} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="config-transfer-scope"
                  checked={item.key === scopeKey}
                  onChange={() => setScopeKey(item.key)}
                  className="accent-sky-600"
                />
                {item.label}
              </label>
            ))}
          </fieldset>
          <p className="text-xs leading-5 text-neutral-500 dark:text-neutral-400">
            {kind.exportNote}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => exporting.mutate('download')} loading={exporting.isPending}>
              <Download className="h-4 w-4" aria-hidden />
              下载 JSON
            </Button>
            <Button
              variant="secondary"
              onClick={() => exporting.mutate('copy')}
              disabled={exporting.isPending}
            >
              复制 JSON
            </Button>
            <Button
              variant="secondary"
              onClick={() => exporting.mutate('ai')}
              disabled={exporting.isPending}
            >
              <Bot className="h-4 w-4" aria-hidden />
              复制给 AI 的说明
            </Button>
          </div>
          <p className="text-xs leading-5 text-neutral-500 dark:text-neutral-400">
            「复制给 AI 的说明」会附带格式规则与当前配置。把它和你的要求（例如「{kind.aiExample}
            」）一起发给 AI，再把生成的 JSON 粘贴到「导入」即可。
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
              <FileUp className="h-4 w-4" aria-hidden />
              选择文件
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void copyText(kind.aiGuide, '已复制格式说明')}
            >
              复制格式说明
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={async (event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) setText(await file.text())
              }}
            />
          </div>
          <textarea
            aria-label={`${kind.title} JSON`}
            className={clsx(inputClass, 'min-h-[40dvh] resize-y font-mono text-xs leading-5')}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={kind.placeholder}
            spellCheck={false}
          />
          {stale && (
            <p className="text-xs text-amber-700 dark:text-amber-300">内容已修改，请重新预览。</p>
          )}
          {preview && !stale && <ImportPreview preview={preview} />}
          {!preview && (
            <p className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
              <Upload className="h-3.5 w-3.5" aria-hidden />
              预览会完整检查每个{kind.noun}，确认无误后才能应用。
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}
