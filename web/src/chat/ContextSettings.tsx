import { useId, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RotateCcw } from 'lucide-react'
import { clsx } from 'clsx'
import type { ConversationDetail, ConversationDTO, MessageDTO } from '@shared/types/api'
import type { ContextAttachmentSelection, ContextPolicy } from '@shared/types/context'
import {
  contextPolicyLabel,
  DEFAULT_CONTEXT_POLICY,
  EMPTY_CONTEXT_SELECTION,
  selectContext,
} from '@shared/util/contextPolicy'
import { getConversationAttachments, updateConversationContext } from '../api/chat'
import { updateSettings } from '../api/settings'
import { Button } from '../components/ui/Button'
import { Checkbox } from '../components/ui/Checkbox'
import { Modal } from '../components/ui/Modal'
import { useSettings } from '../store/settings'
import { useContextSelection } from '../store/contextSelection'
import { ContextRules } from './ContextRules'
import { ContextIcon } from './icons'
import { IconButton } from '../components/ui/IconButton'
import { draftFromPolicy, policyFromDraft } from './contextRuleDraft'
import { ContextAttachmentGallery } from './ContextAttachmentGallery'
import {
  contextAttachmentCatalog,
  selectedContextAttachmentIds,
  setContextAttachmentSelection,
} from './contextAttachments'
import { formatByteSize } from './uploadDraft'
import { useContextSuggestion } from './useContextSuggestion'
import { ContextSuggestionPopover } from './ContextSuggestionPopover'

interface ContextSettingsProps {
  conversation: ConversationDTO
  messages: readonly MessageDTO[]
  allMessages: readonly MessageDTO[]
  imageModel: boolean
  canImage: boolean
  canFile: boolean
  open: boolean
  streaming: boolean
  onOpenChange: (open: boolean) => void
}

function ContextSettingsDialog({
  conversation,
  messages,
  allMessages,
  imageModel,
  canImage,
  canFile,
  initialPolicy,
  initialSelection,
  onClose,
}: Omit<ContextSettingsProps, 'open' | 'onOpenChange'> & {
  initialPolicy: ContextPolicy
  initialSelection: ContextAttachmentSelection
  onClose: () => void
}) {
  const [draft, setDraft] = useState(() => draftFromPolicy(initialPolicy))
  const [selection, setSelection] = useState(initialSelection)
  const [useAsDefault, setUseAsDefault] = useState(false)
  const [tab, setTab] = useState<'attachments' | 'rules'>('attachments')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const formId = useId()
  const queryClient = useQueryClient()
  const policy = policyFromDraft(draft)
  const metadata = useQuery({
    queryKey: ['conversation-attachments', conversation.id, allMessages.length],
    queryFn: () => getConversationAttachments(conversation.id),
    staleTime: 0,
  })
  const items = useMemo(
    () => contextAttachmentCatalog(allMessages, messages, metadata.data ?? []),
    [allMessages, messages, metadata.data],
  )
  const selectedIds = useMemo(
    () =>
      selectedContextAttachmentIds(
        messages,
        policy ?? initialPolicy,
        selection,
        allMessages,
        imageModel,
      ),
    [messages, policy, initialPolicy, selection, allMessages, imageModel],
  )
  const selectedItems = items.filter((item) => selectedIds.has(item.id))
  const selectedBytes = selectedItems.reduce((sum, item) => sum + (item.metadata?.byteSize ?? 0), 0)
  const unavailableCount = selectedItems.filter(
    (item) => item.metadata && !item.metadata.available,
  ).length
  const unsupportedCount = selectedItems.filter((item) =>
    item.part.type === 'input_file' ? !canFile : !canImage,
  ).length
  const historyTurns = selectContext(messages, policy ?? initialPolicy).retained.turns
  const manualCount = selection.include.length + selection.exclude.length
  const rulesChanged = policy && JSON.stringify(policy) !== JSON.stringify(initialPolicy)

  const save = async () => {
    if (!policy || saving) return
    setSaving(true)
    setError('')
    try {
      if (rulesChanged) {
        const updated = await updateConversationContext(conversation.id, policy)
        queryClient.setQueryData<ConversationDetail>(
          ['conversation', conversation.id],
          (current) => (current ? { ...current, conversation: updated } : current),
        )
        queryClient.setQueryData<ConversationDTO[]>(['conversations'], (current) =>
          current?.map((item) => (item.id === updated.id ? updated : item)),
        )
      }
      if (useAsDefault) {
        const settings = await updateSettings({ preferences: { contextPolicy: policy } })
        useSettings.getState().hydrate(settings)
      }
      useContextSelection.getState().set(conversation.id, selection)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      title={
        <span className="inline-flex items-center gap-2">
          <ContextIcon className="h-4 w-4 text-sky-500" />
          上下文优化
        </span>
      }
      size="workspace"
      height="workspace"
      bodyClassName="overflow-hidden"
      onClose={saving ? () => {} : onClose}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <div className="min-w-0" aria-live="polite" aria-atomic="true">
            <p className="text-xs font-medium text-neutral-800 dark:text-neutral-200">
              {imageModel ? '下次使用' : `保留 ${historyTurns} 轮文字 · 携带`}{' '}
              <span className="text-sky-600 dark:text-sky-400">{selectedIds.size} 个附件</span>
              {selectedBytes > 0 && (
                <span
                  title="原文件合计大小"
                  className="ml-2 text-[11px] font-normal text-neutral-400"
                >
                  {formatByteSize(selectedBytes)}
                </span>
              )}
            </p>
            <p className="mt-0.5 text-[11px] text-neutral-400">
              {manualCount > 0
                ? `${manualCount} 项手动调整仅用于下一次发送`
                : '附件随保留规则自动选择'}{' '}
              · 新上传的附件完整携带
            </p>
          </div>
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" disabled={saving} onClick={onClose}>
              取消
            </Button>
            <Button type="submit" form={formId} loading={saving} disabled={!policy || saving}>
              应用
            </Button>
          </div>
        </div>
      }
    >
      <form
        id={formId}
        className="flex h-full min-h-0 flex-col"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <div className="flex shrink-0 gap-1 border-b border-neutral-100 px-4 pt-2 lg:hidden dark:border-neutral-800">
          {(
            [
              { key: 'attachments', label: `附件清单 ${items.length}` },
              { key: 'rules', label: '保留规则' },
            ] as const
          ).map(({ key, label }) => (
            <button
              key={key}
              type="button"
              aria-pressed={tab === key}
              onClick={() => setTab(key)}
              className={clsx(
                'border-b-2 px-4 py-2.5 text-sm font-medium',
                tab === key
                  ? 'border-sky-500 text-sky-600 dark:text-sky-400'
                  : 'border-transparent text-neutral-500 dark:text-neutral-400',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <fieldset
          disabled={saving}
          className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[16rem_minmax(0,1fr)]"
        >
          <aside
            className={clsx(
              'hc-scrollbar min-h-0 overflow-y-auto bg-neutral-50/60 px-4 py-4 lg:border-r lg:border-neutral-200/70 dark:bg-neutral-950/25 dark:lg:border-neutral-800',
              tab !== 'rules' && 'hidden lg:block',
            )}
          >
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">
                自动保留规则
              </h4>
              <button
                type="button"
                title="恢复初始规则"
                aria-label="恢复初始规则"
                onClick={() => setDraft(draftFromPolicy(DEFAULT_CONTEXT_POLICY))}
                className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            </div>
            <ContextRules draft={draft} onChange={setDraft} />
            <div className="mt-1 border-t border-neutral-200/70 pt-3 dark:border-neutral-800">
              <label className="flex cursor-pointer items-start gap-2.5 text-xs leading-relaxed text-neutral-600 dark:text-neutral-400">
                <Checkbox checked={useAsDefault} onChange={setUseAsDefault} />
                同时设为新聊天默认规则
              </label>
              <p className="mt-2 text-[11px] leading-4 text-neutral-400">
                只保存保留方式和数量，不包含手动勾选的附件。
              </p>
            </div>
          </aside>
          <div className={clsx('min-h-0 min-w-0', tab !== 'attachments' && 'hidden lg:block')}>
            <ContextAttachmentGallery
              items={items}
              selectedIds={selectedIds}
              selection={selection}
              onSelect={(ids, checked) =>
                setSelection((current) => setContextAttachmentSelection(current, ids, checked))
              }
              onReset={(ids) =>
                setSelection((current) =>
                  ids
                    ? {
                        include: current.include.filter((id) => !ids.includes(id)),
                        exclude: current.exclude.filter((id) => !ids.includes(id)),
                      }
                    : EMPTY_CONTEXT_SELECTION,
                )
              }
              loading={metadata.isPending}
              loadError={metadata.isError}
              onRetry={() => void metadata.refetch()}
              canImage={canImage}
              canFile={canFile}
            />
          </div>
        </fieldset>
        {(error || !policy || unavailableCount > 0 || unsupportedCount > 0 || imageModel) && (
          <div className="shrink-0 border-t border-neutral-100 bg-neutral-50 px-5 py-2 text-xs leading-relaxed text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
            {error ? (
              <p role="alert" className="text-red-600 dark:text-red-400">
                {error}
              </p>
            ) : !policy ? (
              <p role="alert" className="text-red-600 dark:text-red-400">
                请在保留规则中输入大于 0 的整数。
              </p>
            ) : unavailableCount > 0 ? (
              <p>{unavailableCount} 个选中的附件已不可用，请取消勾选或重新上传。</p>
            ) : unsupportedCount > 0 ? (
              <p>当前模型不支持其中 {unsupportedCount} 个附件，可取消勾选或切换模型。</p>
            ) : imageModel ? (
              <p>图片模型仅使用本次提示词、新上传图片和这里手动选中的参考图。</p>
            ) : null}
          </div>
        )}
      </form>
    </Modal>
  )
}

export function ContextSettings(props: ContextSettingsProps) {
  const { conversation, open, onOpenChange } = props
  const suggestion = useContextSuggestion(
    conversation,
    props.messages,
    !props.imageModel && !props.streaming && !open,
  )
  const openSettings = () => {
    suggestion.dismiss()
    onOpenChange(true)
  }
  const selection =
    useContextSelection((state) => state.byConversation[conversation.id]) ?? EMPTY_CONTEXT_SELECTION
  const policy = conversation.contextPolicy
  const customized =
    JSON.stringify(policy) !== JSON.stringify(DEFAULT_CONTEXT_POLICY) ||
    selection.include.length + selection.exclude.length > 0
  return (
    <>
      <IconButton
        label="上下文优化"
        variant="toolbar"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`上下文优化${customized ? '（已调整）' : ''}：${contextPolicyLabel(policy)}`}
        onClick={openSettings}
      >
        <ContextIcon />
        {customized && (
          <span aria-hidden className="absolute right-1 top-1 h-1 w-1 rounded-full bg-sky-500" />
        )}
      </IconButton>
      {suggestion.visible && (
        <ContextSuggestionPopover
          tokens={suggestion.tokens}
          onOpen={openSettings}
          onDismiss={suggestion.dismiss}
        />
      )}
      {open && (
        <ContextSettingsDialog
          {...props}
          initialPolicy={policy}
          initialSelection={selection}
          onClose={() => onOpenChange(false)}
        />
      )}
    </>
  )
}
