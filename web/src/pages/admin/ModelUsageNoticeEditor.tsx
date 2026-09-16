import { DEFAULT_MODEL_USAGE_NOTICE, type ModelUsageNotice } from '@shared/schemas/user-notices'
import { UsageNoticeMessage } from '../../chat/UsageNoticeMessage'
import { Toggle } from '../../components/ui/Toggle'
import { Select } from '../../components/ui/Select'
import { inputClass } from '../../components/ui/controlStyles'
import { Field } from './FormField'

export function ModelUsageNoticeEditor({
  value,
  onChange,
  modelName,
}: {
  value: ModelUsageNotice
  onChange: (notice: ModelUsageNotice) => void
  modelName: string
}) {
  const patch = (partial: Partial<ModelUsageNotice>) => onChange({ ...value, ...partial })
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-neutral-800 dark:text-neutral-100">显示使用提示</p>
          <p className="mt-1 text-xs leading-5 text-neutral-500">
            选用这个模型后，在输入框上方展示注意事项。
          </p>
        </div>
        <Toggle
          ariaLabel="显示模型使用提示"
          checked={value.enabled}
          onChange={(enabled) => patch({ enabled })}
        />
      </div>
      {value.enabled && (
        <>
          <Field label="提示标题（可选）">
            <input
              className={inputClass}
              value={value.title}
              onChange={(event) => patch({ title: event.target.value })}
              maxLength={80}
              placeholder={DEFAULT_MODEL_USAGE_NOTICE.title}
            />
          </Field>
          <Field label="提示正文">
            <textarea
              className={`${inputClass} min-h-28 resize-y leading-6`}
              value={value.body}
              onChange={(event) => patch({ body: event.target.value })}
              maxLength={2000}
              placeholder={DEFAULT_MODEL_USAGE_NOTICE.body}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="提示风格"
              className="w-full"
              value={value.tone}
              onChange={(event) => patch({ tone: event.target.value as ModelUsageNotice['tone'] })}
              options={[
                { value: 'info', label: '信息 · 蓝色' },
                { value: 'tip', label: '建议 · 紫色' },
                { value: 'warning', label: '提醒 · 琥珀色' },
              ]}
            />
            <Select
              label="显示频率"
              className="w-full"
              value={value.frequency}
              onChange={(event) =>
                patch({ frequency: event.target.value as ModelUsageNotice['frequency'] })
              }
              options={[
                { value: 'once', label: '确认后不再提示' },
                { value: 'always', label: '每次选用时提示' },
              ]}
            />
          </div>
          {value.frequency === 'always' ? (
            <div className="flex items-center justify-between gap-4 text-sm text-neutral-600 dark:text-neutral-300">
              <span>允许本次关闭</span>
              <Toggle
                ariaLabel="允许本次关闭模型提示"
                checked={value.dismissible}
                onChange={(dismissible) => patch({ dismissible })}
              />
            </div>
          ) : (
            <p className="text-xs leading-5 text-neutral-500">
              确认状态保存在当前浏览器，按账号区分。修改提示内容后会再次展示。
            </p>
          )}
          {value.body.trim() && (
            <div className="space-y-2 pt-1">
              <p className="text-xs text-neutral-400">用户看到的效果</p>
              <UsageNoticeMessage
                notice={value}
                modelName={modelName || '模型'}
                onDismiss={
                  value.frequency === 'once' || value.dismissible ? () => undefined : undefined
                }
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
