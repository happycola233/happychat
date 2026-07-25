import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RotateCcw } from 'lucide-react'
import { DEFAULT_TITLE_PROMPT } from '@shared/constants'
import type { AppConfigDTO } from '@shared/types/api'
import { getStats, listAdminModels } from '../../api/admin'
import { getAppConfig, updateAppConfig } from '../../api/appConfig'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { PageHeader } from '../../components/ui/PageHeader'
import { Select } from '../../components/ui/Select'
import { Spinner } from '../../components/ui/Spinner'
import { Toggle } from '../../components/ui/Toggle'
import { toast } from '../../store/toast'

/** 只读信息行（「关于」卡片用）。 */
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-neutral-100 py-2.5 text-sm last:border-0 dark:border-neutral-800">
      <span className="text-neutral-500">{label}</span>
      <span className="font-medium text-neutral-800 tabular-nums dark:text-neutral-200">
        {value}
      </span>
    </div>
  )
}

/** 标题总结的本地草稿：配置未加载完成前为 null，避免先渲染猜测值再跳变。 */
interface TitleDraft {
  enabled: boolean
  modelId: string
  /** 提示词始终以「已填写」状态呈现：未自定义时填入内置默认文案，方便在其基础上修改。 */
  prompt: string
}

const toTitleDraft = (config: AppConfigDTO): TitleDraft => ({
  enabled: config.titleEnabled,
  modelId: config.titleModelId ?? '',
  prompt: config.titlePrompt ?? DEFAULT_TITLE_PROMPT,
})

export default function SettingsPage() {
  const qc = useQueryClient()
  const { data: stats } = useQuery({ queryKey: ['admin', 'stats'], queryFn: getStats })
  const { data: config } = useQuery({
    queryKey: ['admin', 'app-config'],
    queryFn: getAppConfig,
  })
  const { data: models } = useQuery({ queryKey: ['admin', 'models'], queryFn: listAdminModels })

  const [titleDraft, setTitleDraft] = useState<TitleDraft | null>(null)
  // 在渲染期（而非 effect 里）同步服务端配置：effect 要等一帧才生效，会先把旧草稿刷到屏幕上造成闪烁。
  const syncedConfigRef = useRef<AppConfigDTO | null>(null)
  if (config && syncedConfigRef.current !== config) {
    syncedConfigRef.current = config
    setTitleDraft(toTitleDraft(config))
  }

  const invalidateConfig = () => qc.invalidateQueries({ queryKey: ['admin', 'app-config'] })

  // 注册策略是单个全局开关，切换即保存。
  const toggleRegistrationRequirement = useMutation({
    mutationFn: (registrationRequiresInviteCode: boolean) =>
      updateAppConfig({ registrationRequiresInviteCode }),
    onSuccess: invalidateConfig,
    onError: (e) => toast.error(e instanceof Error ? e.message : '操作失败'),
  })

  // 分享是单个开关，切换即保存（与其他管理页的开关交互一致）。
  const toggleSharing = useMutation({
    mutationFn: (sharingEnabled: boolean) => updateAppConfig({ sharingEnabled }),
    onSuccess: invalidateConfig,
    onError: (e) => toast.error(e instanceof Error ? e.message : '操作失败'),
  })

  const saveTitle = useMutation({
    mutationFn: (draft: TitleDraft) => {
      const prompt = draft.prompt.trim()
      return updateAppConfig({
        titleEnabled: draft.enabled,
        titleModelId: draft.modelId || null,
        // 与内置默认一致（或清空）时存 null，跟随内置默认的后续更新。
        titlePrompt: prompt && prompt !== DEFAULT_TITLE_PROMPT ? prompt : null,
      })
    },
    onSuccess: () => {
      toast.success('已保存')
      invalidateConfig()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '保存失败'),
  })

  const textModels = (models ?? []).filter((m) => m.kind !== 'image')
  const promptIsDefault = titleDraft?.prompt.trim() === DEFAULT_TITLE_PROMPT
  const patchTitleDraft = (patch: Partial<TitleDraft>) =>
    setTitleDraft((prev) => (prev ? { ...prev, ...patch } : prev))

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title="系统设置" description="全局功能开关与标题总结配置。" />

      {/* 配置到位后才渲染开关与表单：先画默认值会让刷新时所有开关闪一下「已开启」。 */}
      {!config || !titleDraft ? (
        <div className="py-16 text-center">
          <Spinner className="h-6 w-6 text-neutral-400" />
        </div>
      ) : (
        <>
          <Card title="注册">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm text-neutral-800 dark:text-neutral-100">注册需要邀请码</div>
                <div className="mt-0.5 text-xs leading-5 text-neutral-400 dark:text-neutral-500">
                  首位管理员始终无需邀请码。关闭后，任何访客都能直接创建账号。
                </div>
                {!config.registrationRequiresInviteCode && (
                  <div className="mt-1 text-xs leading-5 text-amber-600 dark:text-amber-400">
                    当前为开放注册；公开部署时可能遭遇批量注册或资源滥用，请谨慎使用。
                  </div>
                )}
              </div>
              <Toggle
                checked={config.registrationRequiresInviteCode}
                disabled={toggleRegistrationRequirement.isPending}
                ariaLabel="注册需要邀请码"
                onChange={(v) => toggleRegistrationRequirement.mutate(v)}
              />
            </div>
          </Card>

          <Card title="分享">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm text-neutral-800 dark:text-neutral-100">
                  允许用户分享聊天
                </div>
                <div className="mt-0.5 text-xs text-neutral-400">
                  全局开关，切换立即生效；可在账号中心对个别用户单独覆盖。
                </div>
              </div>
              <Toggle
                checked={config.sharingEnabled}
                disabled={toggleSharing.isPending}
                onChange={(v) => toggleSharing.mutate(v)}
              />
            </div>
          </Card>

          <Card title="标题总结" description="首条回复完成后用模型自动生成简短的会话标题。">
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="text-sm text-neutral-800 dark:text-neutral-100">
                  自动总结对话标题
                </div>
                <Toggle
                  checked={titleDraft.enabled}
                  onChange={(v) => patchTitleDraft({ enabled: v })}
                />
              </div>

              {titleDraft.enabled && (
                <>
                  <label className="block">
                    <span className="mb-1.5 block text-xs text-neutral-500">标题模型</span>
                    <Select
                      className="w-full"
                      value={titleDraft.modelId}
                      onChange={(e) => patchTitleDraft({ modelId: e.target.value })}
                      options={[
                        { value: '', label: '自动（首个可用文本模型）' },
                        ...textModels.map((m) => ({ value: m.id, label: m.displayName })),
                      ]}
                    />
                  </label>

                  <div>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="text-xs text-neutral-500">
                        标题提示词（变量：{'{content}'} 对话内容、{'{locale}'} 浏览器语言）
                      </span>
                      {!promptIsDefault && (
                        <button
                          type="button"
                          onClick={() => patchTitleDraft({ prompt: DEFAULT_TITLE_PROMPT })}
                          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
                        >
                          <RotateCcw className="h-3 w-3" /> 恢复默认
                        </button>
                      )}
                    </div>
                    <textarea
                      className="min-h-[180px] w-full resize-y rounded-xl border border-neutral-300 bg-white px-3.5 py-2.5 font-mono text-xs leading-5 text-neutral-800 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:focus:border-sky-400"
                      value={titleDraft.prompt}
                      onChange={(e) => patchTitleDraft({ prompt: e.target.value })}
                    />
                    <span className="mt-1 block text-xs text-neutral-400">
                      {promptIsDefault
                        ? '当前为内置默认提示词，可直接在其基础上修改。'
                        : '已自定义；点右上角「恢复默认」可还原内置文案。'}
                    </span>
                  </div>
                </>
              )}

              <div className="flex justify-end">
                <Button loading={saveTitle.isPending} onClick={() => saveTitle.mutate(titleDraft)}>
                  保存
                </Button>
              </div>
            </div>
          </Card>
        </>
      )}

      <Card title="关于">
        <div className="-my-1">
          <InfoRow label="版本" value="0.1.0" />
          <InfoRow label="用户数" value={String(stats?.totals.users ?? '—')} />
          <InfoRow label="会话数" value={String(stats?.totals.conversations ?? '—')} />
        </div>
      </Card>
    </div>
  )
}
