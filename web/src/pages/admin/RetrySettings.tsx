import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, RotateCw } from 'lucide-react'
import type { AppConfigDTO } from '@shared/types/api'
import {
  DEFAULT_RETRY_POLICY,
  RETRYABLE_HTTP_STATUSES,
  retryDelayMs,
  retryPolicySchema,
  type RetryPolicy,
} from '@shared/schemas/retry'
import { updateAppConfig } from '../../api/appConfig'
import { Button } from '../../components/ui/Button'
import { Toggle } from '../../components/ui/Toggle'
import { inputClass } from '../../components/ui/controlStyles'
import { toast } from '../../store/toast'

const statusLabels: Record<number, string> = {
  408: '请求超时',
  409: '请求冲突',
  429: '服务限流',
  500: '内部错误',
  502: '网关错误',
  503: '暂时不可用',
  504: '网关超时',
  529: '服务过载',
}

const fields: {
  key: keyof RetryPolicy
  label: string
  unit: string
  min: number
  max?: number
  step?: number
  description?: string
}[] = [
  { key: 'maxRetries', label: '最多重试', unit: '次', min: 1, max: 20 },
  { key: 'initialDelaySeconds', label: '首次等待', unit: '秒', min: 1, max: 120 },
  { key: 'backoffMultiplier', label: '间隔递增倍率', unit: '倍', min: 1, max: 5, step: 0.1 },
  { key: 'maxDelaySeconds', label: '最长重试间隔', unit: '秒', min: 1, max: 600 },
  {
    key: 'attemptTimeoutSeconds',
    label: '单次连接等待上限',
    unit: '秒',
    min: 1,
    description: '从发送请求到收到响应头的最长时间，不限制后续生成时长。',
  },
  { key: 'maxElapsedSeconds', label: '总等待上限', unit: '秒', min: 1 },
  {
    key: 'jitterPercent',
    label: '额外随机等待',
    unit: '%',
    min: 0,
    max: 50,
    description: '在每次间隔上随机增加等待。例如 5 秒、20% 时为 5–6 秒；设为 0 则不增加。',
  },
]

export function RetrySettings({ config }: { config: AppConfigDTO }) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState(config.upstreamRetry)
  const saved = useRef(config.upstreamRetry)
  if (saved.current !== config.upstreamRetry) {
    const pristine = JSON.stringify(draft) === JSON.stringify(saved.current)
    saved.current = config.upstreamRetry
    if (pristine) setDraft(config.upstreamRetry)
  }
  const dirty = JSON.stringify(draft) !== JSON.stringify(config.upstreamRetry)
  const validation = retryPolicySchema.safeParse(draft)
  const update = (patch: Partial<RetryPolicy>) => setDraft((value) => ({ ...value, ...patch }))
  const save = useMutation({
    mutationFn: () => updateAppConfig({ upstreamRetry: retryPolicySchema.parse(draft) }),
    onSuccess: (value) => {
      qc.setQueryData(['admin', 'app-config'], value)
      setDraft(value.upstreamRetry)
      toast.success('已保存重试设置')
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : '保存失败'),
  })
  return (
    <fieldset
      disabled={save.isPending}
      className="min-w-0 space-y-7 py-2"
      aria-label="自动重试设置"
    >
      <div className="flex items-start justify-between gap-5">
        <div>
          <h2 className="text-base font-medium text-neutral-900 dark:text-neutral-100">自动重试</h2>
          <p className="mt-1 max-w-xl text-sm leading-6 text-neutral-500 dark:text-neutral-400">
            上游暂时不可用时，在后台等待并重新连接。用户可以稍后返回，也可以随时停止生成。
          </p>
        </div>
        <Toggle
          checked={draft.enabled}
          ariaLabel="启用自动重试"
          onChange={(enabled) => update({ enabled })}
        />
      </div>

      {draft.enabled && (
        <>
          <div className="rounded-2xl bg-neutral-50 px-5 py-4 dark:bg-neutral-900/60">
            <div className="flex items-center gap-2 text-xs text-neutral-500">
              <RotateCw className="h-3.5 w-3.5" />
              连续失败时的等待节奏
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-neutral-700 dark:text-neutral-200">
              {Array.from({ length: Math.min(draft.maxRetries || 1, 8) }, (_, index) => (
                <span key={index} className="inline-flex items-center gap-3">
                  {index > 0 && (
                    <ArrowRight className="h-3 w-3 text-neutral-300 dark:text-neutral-600" />
                  )}
                  <span className="tabular-nums">
                    {(retryDelayMs(draft, index + 1, 0) / 1000).toLocaleString()}
                    <span className="ml-1 text-xs text-neutral-400">秒</span>
                  </span>
                </span>
              ))}
              {draft.maxRetries > 8 && <span className="text-neutral-400">…</span>}
            </div>
            <p className="mt-3 text-xs leading-5 text-neutral-500">
              在此基础上随机增加至多 {draft.jitterPercent}% 的等待，避免请求集中重试，最长{' '}
              {draft.maxDelaySeconds} 秒。上游要求稍后重试时会尊重其等待时间；超过总等待上限则结束。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-5 gap-y-5 sm:grid-cols-3">
            {fields.map(({ key, label, unit, min, max, step, description }) => (
              <label key={key} className="block">
                <span className="mb-2 block text-xs text-neutral-600 dark:text-neutral-400">
                  {label}
                </span>
                <div className="relative">
                  <input
                    type="number"
                    aria-label={label}
                    className={`${inputClass} w-full pr-10 tabular-nums`}
                    min={min}
                    max={max}
                    step={step ?? 1}
                    value={draft[key] as number}
                    onChange={(event) => update({ [key]: Number(event.target.value) })}
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral-400">
                    {unit}
                  </span>
                </div>
                {description && (
                  <p className="mt-1.5 text-[11px] leading-5 text-neutral-500 dark:text-neutral-400">
                    {description}
                  </p>
                )}
              </label>
            ))}
          </div>
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
              遇到这些错误时重试
            </h3>
            <div className="flex flex-wrap gap-2">
              {RETRYABLE_HTTP_STATUSES.map((status) => {
                const selected = draft.retryStatusCodes.includes(status)
                return (
                  <button
                    type="button"
                    key={status}
                    aria-pressed={selected}
                    onClick={() =>
                      update({
                        retryStatusCodes: selected
                          ? draft.retryStatusCodes.filter((code) => code !== status)
                          : [...draft.retryStatusCodes, status].sort((a, b) => a - b),
                      })
                    }
                    className={`rounded-lg px-3 py-2 text-xs transition focus-visible:outline-2 focus-visible:outline-sky-500 ${selected ? 'bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300' : 'bg-neutral-50 text-neutral-400 dark:bg-neutral-900 dark:text-neutral-500'}`}
                  >
                    <span className="mr-1.5 font-mono">{status}</span>
                    {statusLabels[status]}
                  </button>
                )
              })}
            </div>
            <div className="flex items-center justify-between gap-4 py-2">
              <div>
                <p className="text-sm text-neutral-600 dark:text-neutral-400">
                  网络连接失败或等待响应超时时重试
                </p>
                <p className="mt-1 max-w-xl text-xs leading-5 text-neutral-500 dark:text-neutral-400">
                  无法建立连接、连接在响应前中断，或超过单次等待上限仍未收到响应头时重试。
                </p>
              </div>
              <Toggle
                checked={draft.retryNetworkErrors}
                ariaLabel="网络连接失败或等待响应超时时重试"
                onChange={(retryNetworkErrors) => update({ retryNetworkErrors })}
              />
            </div>
            <p className="text-xs leading-6 text-neutral-500">
              仅在收到响应前重试；已开始的输出会保留，流中断后可手动重新生成。密钥、参数或余额问题会直接提示失败。设置对新发起的生成生效。
            </p>
          </div>
        </>
      )}
      {!validation.success && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {validation.error.issues[0]?.message}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span role="status" className="mr-auto text-xs text-neutral-500">
          {dirty ? '有未保存的修改' : '已保存'}
        </span>
        <Button
          variant="ghost"
          onClick={() => setDraft({ ...DEFAULT_RETRY_POLICY, enabled: draft.enabled })}
        >
          恢复默认参数
        </Button>
        {dirty && (
          <Button variant="ghost" onClick={() => setDraft(config.upstreamRetry)}>
            撤销修改
          </Button>
        )}
        <Button
          disabled={!dirty || !validation.success}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          保存重试设置
        </Button>
      </div>
    </fieldset>
  )
}
