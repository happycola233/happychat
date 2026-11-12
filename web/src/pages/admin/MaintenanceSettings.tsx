import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import type { AppConfigDTO } from '@shared/types/api'
import type {
  MaintenanceConfig,
  MaintenanceLanguage,
  MaintenanceNotice,
} from '@shared/schemas/maintenance'
import { updateAppConfig } from '../../api/appConfig'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { Toggle } from '../../components/ui/Toggle'
import { fieldLabelClass, inputClass } from '../../components/ui/controlStyles'
import { parseLocalDateTimeInput, toLocalDateTimeInput } from '../../lib/localDateTime'
import { MAINTENANCE_QUERY_KEY } from '../../hooks/useMaintenance'
import { MaintenancePage } from '../../maintenance/MaintenancePage'
import { maintenanceLanguages } from '../../maintenance/maintenanceCopy'
import { toast } from '../../store/toast'

/** 维护页内容的本地草稿：补充说明以字符串编辑，保存时空白归一为 null。 */
interface NoticeDraft {
  language: MaintenanceLanguage
  noteZh: string
  noteEn: string
  expectedEndAt: number | null
}

const toDraft = (maintenance: MaintenanceConfig): NoticeDraft => ({
  language: maintenance.language,
  noteZh: maintenance.noteZh ?? '',
  noteEn: maintenance.noteEn ?? '',
  expectedEndAt: maintenance.expectedEndAt,
})

const toNotice = (draft: NoticeDraft): MaintenanceNotice => ({
  language: draft.language,
  noteZh: draft.noteZh.trim() || null,
  noteEn: draft.noteEn.trim() || null,
  expectedEndAt: draft.expectedEndAt,
})

const NOTE_FIELDS = {
  zh: { key: 'noteZh', label: '补充说明（中文）', placeholder: '例如：正在升级模型线路。' },
  en: {
    key: 'noteEn',
    label: '补充说明（英文）',
    placeholder: 'e.g. We’re upgrading our model providers.',
  },
} as const

export function MaintenanceSettings({ config }: { config: AppConfigDTO }) {
  const qc = useQueryClient()
  const maintenance = config.maintenance
  const [draft, setDraft] = useState(() => toDraft(maintenance))
  const [previewing, setPreviewing] = useState(false)
  // 保存其他设置会刷新整份配置；未改动的草稿跟随服务端，已改动的保留。
  const saved = useRef(maintenance)
  if (saved.current !== maintenance) {
    const pristine = JSON.stringify(draft) === JSON.stringify(toDraft(saved.current))
    saved.current = maintenance
    if (pristine) setDraft(toDraft(maintenance))
  }
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(maintenance))
  const update = (patch: Partial<NoticeDraft>) => setDraft((value) => ({ ...value, ...patch }))

  /** contentSaved：本次请求是否提交了维护页内容；只切换开关时保留尚未保存的草稿。 */
  const applySaved = (value: AppConfigDTO, contentSaved: boolean) => {
    qc.setQueryData(['admin', 'app-config'], value)
    if (contentSaved) setDraft(toDraft(value.maintenance))
    // 管理员界面的维护提醒条读取同一份公开状态。
    void qc.invalidateQueries({ queryKey: MAINTENANCE_QUERY_KEY })
  }
  const onError = (error: unknown) =>
    toast.error(error instanceof Error ? error.message : '保存失败')

  // 开启时连同当前填写的内容一起保存：访客看到的就是此刻屏幕上的设置。
  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      updateAppConfig({ maintenance: enabled ? { ...toNotice(draft), enabled } : { enabled } }),
    onSuccess: (value) => {
      applySaved(value, value.maintenance.enabled)
      toast.success(value.maintenance.enabled ? '维护模式已开启' : '维护已结束，网站恢复使用')
    },
    onError,
  })
  const save = useMutation({
    mutationFn: () => updateAppConfig({ maintenance: toNotice(draft) }),
    onSuccess: (value) => {
      applySaved(value, true)
      toast.success('已保存维护页内容')
    },
    onError,
  })

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm text-neutral-800 dark:text-neutral-100">
              维护模式
              {maintenance.enabled && <Badge tone="warning">维护中</Badge>}
            </div>
            <div className="mt-0.5 max-w-2xl text-xs leading-5 text-neutral-400 dark:text-neutral-500">
              开启后，其他用户会看到维护页，暂时无法使用网站；管理员照常使用。正在生成的回答会继续完成，排队中的消息在维护结束后自动发送。
            </div>
          </div>
          <Toggle
            ariaLabel="维护模式"
            checked={maintenance.enabled}
            disabled={toggle.isPending}
            onChange={(enabled) => toggle.mutate(enabled)}
          />
        </div>
      </Card>

      <Card title="维护页内容" description="维护期间访客看到的页面。">
        <fieldset disabled={save.isPending} className="min-w-0 space-y-5">
          <div>
            <span className={fieldLabelClass}>显示语言</span>
            <SegmentedControl
              label="维护页显示语言"
              value={draft.language}
              onChange={(language) => update({ language })}
              options={[
                { value: 'zh', label: '中文' },
                { value: 'en', label: 'English' },
                { value: 'both', label: '中英双语' },
              ]}
            />
          </div>

          {maintenanceLanguages(draft.language).map((language) => {
            const field = NOTE_FIELDS[language]
            return (
              <label key={language} className="block">
                <span className={fieldLabelClass}>{field.label}</span>
                <textarea
                  className={`${inputClass} min-h-[72px] resize-y leading-6`}
                  maxLength={500}
                  placeholder={field.placeholder}
                  value={draft[field.key]}
                  onChange={(event) => update({ [field.key]: event.target.value })}
                />
              </label>
            )
          })}

          <div>
            <label htmlFor="maintenance-expected-end" className={fieldLabelClass}>
              预计恢复时间
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="maintenance-expected-end"
                type="datetime-local"
                className={`${inputClass} sm:w-60`}
                value={
                  draft.expectedEndAt === null ? '' : toLocalDateTimeInput(draft.expectedEndAt)
                }
                onChange={(event) =>
                  update({ expectedEndAt: parseLocalDateTimeInput(event.target.value) })
                }
              />
              {draft.expectedEndAt !== null && (
                <Button variant="ghost" onClick={() => update({ expectedEndAt: null })}>
                  清除
                </Button>
              )}
            </div>
            <p className="mt-1.5 text-xs leading-5 text-neutral-400 dark:text-neutral-500">
              按访客所在时区显示在维护页上。到时间后不会自动结束维护，已过去的时间不再显示。
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <span role="status" className="mr-auto text-xs text-neutral-500">
              {dirty ? '有未保存的修改' : '已保存'}
            </span>
            <Button variant="ghost" onClick={() => setPreviewing(true)}>
              预览维护页
            </Button>
            {dirty && (
              <Button variant="ghost" onClick={() => setDraft(toDraft(maintenance))}>
                撤销修改
              </Button>
            )}
            <Button disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
              保存维护页内容
            </Button>
          </div>
        </fieldset>
      </Card>

      {previewing && (
        <MaintenancePreview notice={toNotice(draft)} onClose={() => setPreviewing(false)} />
      )}
    </div>
  )
}

/** 全屏预览：与访客看到的页面完全一致，仅多一个关闭按钮。 */
function MaintenancePreview({
  notice,
  onClose,
}: {
  notice: MaintenanceNotice
  onClose: () => void
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="维护页预览"
      className="fixed inset-0 z-[100] overflow-y-auto"
    >
      <MaintenancePage notice={notice} />
      <button
        type="button"
        autoFocus
        onClick={onClose}
        className="fixed left-4 top-[max(1rem,env(safe-area-inset-top))] z-10 inline-flex h-9 items-center gap-1.5 rounded-full border border-black/[0.07] bg-white/70 px-3.5 text-[13px] text-neutral-700 backdrop-blur-md transition hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/60 dark:border-white/10 dark:bg-white/[0.05] dark:text-neutral-200 dark:hover:text-white"
      >
        <X className="h-4 w-4" />
        关闭预览
      </button>
    </div>,
    document.body,
  )
}
