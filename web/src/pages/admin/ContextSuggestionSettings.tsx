import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { AppConfigDTO } from '@shared/types/api'
import { contextOptimizationSuggestionSchema } from '@shared/schemas/user-notices'
import { updateAppConfig } from '../../api/appConfig'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Toggle } from '../../components/ui/Toggle'
import { inputClass } from '../../components/ui/controlStyles'
import { toast } from '../../store/toast'

export function ContextSuggestionSettings({ config }: { config: AppConfigDTO }) {
  const qc = useQueryClient()
  const saved = config.contextOptimizationSuggestion
  const [draft, setDraft] = useState(saved)
  const [threshold, setThreshold] = useState(String(saved.tokenThreshold))
  const previous = useRef(saved)
  if (previous.current !== saved) {
    if (
      JSON.stringify(draft) === JSON.stringify(previous.current) &&
      threshold === String(previous.current.tokenThreshold)
    ) {
      setDraft(saved)
      setThreshold(String(saved.tokenThreshold))
    }
    previous.current = saved
  }
  const next = { ...draft, tokenThreshold: Number(threshold) }
  const valid = contextOptimizationSuggestionSchema.safeParse(next).success
  const dirty = JSON.stringify(next) !== JSON.stringify(saved)
  const save = useMutation({
    mutationFn: () => updateAppConfig({ contextOptimizationSuggestion: next }),
    onSuccess: (value) => {
      qc.setQueryData(['admin', 'app-config'], value)
      void qc.invalidateQueries({ queryKey: ['models'] })
      setDraft(value.contextOptimizationSuggestion)
      setThreshold(String(value.contextOptimizationSuggestion.tokenThreshold))
      toast.success('上下文提醒已保存')
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : '保存失败'),
  })
  return (
    <Card title="长对话提醒" description="在对话变长时，帮助用户发现上下文优化。" className="mt-4">
      <fieldset disabled={save.isPending} className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="text-sm text-neutral-800 dark:text-neutral-100">建议优化上下文</div>
          <Toggle
            ariaLabel="建议优化上下文"
            checked={draft.enabled}
            onChange={(enabled) => setDraft({ ...draft, enabled })}
          />
        </div>
        {draft.enabled && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <label
                htmlFor="context-suggestion-threshold"
                className="text-sm text-neutral-700 dark:text-neutral-200"
              >
                提醒阈值
              </label>
              <p className="mt-1 max-w-xl text-xs leading-5 text-neutral-500">
                按当前保留的对话文字估算
                Token，不包含附件或私有思考内容，也不影响实际请求。用户可在当前标签页关闭本次聊天的提醒。
              </p>
            </div>
            <div className="w-full shrink-0 sm:w-44">
              <div className="relative">
                <input
                  id="context-suggestion-threshold"
                  type="number"
                  min={1000}
                  max={2000000}
                  step={1000}
                  className={`${inputClass} pr-16 tabular-nums`}
                  value={threshold}
                  onChange={(event) => setThreshold(event.target.value)}
                />
                <span className="pointer-events-none absolute right-3 top-2.5 text-xs text-neutral-400">
                  tokens
                </span>
              </div>
              {!valid && (
                <p role="alert" className="mt-1 text-xs text-red-500">
                  请输入 1,000–2,000,000 的整数
                </p>
              )}
            </div>
          </div>
        )}
        <div className="flex items-center justify-end gap-2">
          <span role="status" className="mr-auto text-xs text-neutral-500">
            {dirty ? '有未保存的修改' : '已保存'}
          </span>
          {dirty && (
            <Button
              variant="ghost"
              onClick={() => {
                setDraft(saved)
                setThreshold(String(saved.tokenThreshold))
              }}
            >
              撤销修改
            </Button>
          )}
          <Button
            disabled={!dirty || !valid}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            保存提醒设置
          </Button>
        </div>
      </fieldset>
    </Card>
  )
}
