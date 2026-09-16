import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { AppConfigDTO } from '@shared/types/api'
import { updateAppConfig } from '../../api/appConfig'
import { Button } from '../../components/ui/Button'
import { inputClass } from '../../components/ui/controlStyles'
import { toast } from '../../store/toast'

type QuotaMessages = Pick<AppConfigDTO, 'quotaWarningMessage' | 'quotaExhaustedMessage'>

const MESSAGE_FIELDS = [
  {
    key: 'quotaWarningMessage',
    label: '接近限额时的提示',
    placeholder: '例如：可提前联系管理员申请更多额度。',
  },
  {
    key: 'quotaExhaustedMessage',
    label: '已达到限额时的提示',
    placeholder: '例如：如需继续使用，请联系管理员调整额度。',
  },
] as const

function editableMessages(config: QuotaMessages) {
  return {
    quotaWarningMessage: config.quotaWarningMessage ?? '',
    quotaExhaustedMessage: config.quotaExhaustedMessage ?? '',
  }
}

export function QuotaNoticeSettings({ config }: { config: QuotaMessages }) {
  const qc = useQueryClient()
  const saved = editableMessages(config)
  const [draft, setDraft] = useState(saved)
  const previous = useRef(saved)
  // 后台其他设置保存后只同步未编辑的字段，不覆盖正在输入的提示。
  if (MESSAGE_FIELDS.some(({ key }) => previous.current[key] !== saved[key])) {
    setDraft({
      quotaWarningMessage:
        draft.quotaWarningMessage === previous.current.quotaWarningMessage
          ? saved.quotaWarningMessage
          : draft.quotaWarningMessage,
      quotaExhaustedMessage:
        draft.quotaExhaustedMessage === previous.current.quotaExhaustedMessage
          ? saved.quotaExhaustedMessage
          : draft.quotaExhaustedMessage,
    })
    previous.current = saved
  }
  const dirty = MESSAGE_FIELDS.some(({ key }) => draft[key].trim() !== saved[key])
  const save = useMutation({
    mutationFn: () =>
      updateAppConfig({
        quotaWarningMessage: draft.quotaWarningMessage.trim() || null,
        quotaExhaustedMessage: draft.quotaExhaustedMessage.trim() || null,
      }),
    onSuccess: (updatedConfig) => {
      setDraft(editableMessages(updatedConfig))
      qc.setQueryData(['admin', 'app-config'], updatedConfig)
      void qc.invalidateQueries({ queryKey: ['quota', 'me'] })
      toast.success('额度提示已保存')
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : '保存失败'),
  })

  return (
    <fieldset disabled={save.isPending} className="mt-5 space-y-3">
      <div className="grid gap-4 sm:grid-cols-2">
        {MESSAGE_FIELDS.map(({ key, label, placeholder }) => (
          <div key={key} className="space-y-2">
            <div className="flex min-h-8 items-center justify-between gap-3">
              <label
                htmlFor={key}
                className="text-xs font-medium text-neutral-700 dark:text-neutral-200"
              >
                {label}
                <span className="ml-2 font-normal text-neutral-400">可选</span>
              </label>
              {draft[key] && (
                <button
                  type="button"
                  aria-label={`清空${label}`}
                  className="min-h-8 rounded-lg text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
                  onClick={() => setDraft((current) => ({ ...current, [key]: '' }))}
                >
                  清空
                </button>
              )}
            </div>
            <textarea
              id={key}
              className={`${inputClass} min-h-24 resize-y leading-6`}
              value={draft[key]}
              maxLength={2000}
              onChange={(event) =>
                setDraft((current) => ({ ...current, [key]: event.target.value }))
              }
              placeholder={placeholder}
            />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <p className="mr-auto text-xs leading-5 text-neutral-500">
          留空时仅显示额度状态、用量与恢复时间。
        </p>
        {dirty && (
          <Button variant="ghost" onClick={() => setDraft(saved)}>
            撤销修改
          </Button>
        )}
        <Button size="sm" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
          保存额度提示
        </Button>
      </div>
    </fieldset>
  )
}
