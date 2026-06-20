import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getStats, listAdminModels } from '../../api/admin'
import { getAppConfig, updateAppConfig } from '../../api/shares'
import { Button } from '../../components/ui/Button'
import { Select } from '../../components/ui/Select'
import { Toggle } from '../../components/ui/Toggle'
import { toast } from '../../store/toast'

const DEFAULT_TITLE_PROMPT_HINT = `I will give you some dialogue content in the <content> block.
You need to summarize the conversation between user and assistant into a short title.
1. The title language should be consistent with the user's primary language
2. Do not use punctuation or other special symbols
3. Reply directly with the title
4. Summarize using {locale} language
5. The title should not exceed 12 characters

<content>
{content}
</content>`

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-neutral-100 py-3 text-sm last:border-0 dark:border-neutral-800">
      <span className="text-neutral-500">{label}</span>
      <span className="font-medium text-neutral-800 dark:text-neutral-200">{value}</span>
    </div>
  )
}

export default function SettingsPage() {
  const qc = useQueryClient()
  const { data: stats } = useQuery({ queryKey: ['admin', 'stats'], queryFn: getStats })
  const { data: config, isLoading } = useQuery({
    queryKey: ['admin', 'app-config'],
    queryFn: getAppConfig,
  })
  const { data: models } = useQuery({ queryKey: ['admin', 'models'], queryFn: listAdminModels })

  const [sharingEnabled, setSharingEnabled] = useState(true)
  const [titleEnabled, setTitleEnabled] = useState(true)
  const [titleModelId, setTitleModelId] = useState('')
  const [titlePrompt, setTitlePrompt] = useState('')

  useEffect(() => {
    if (config) {
      setSharingEnabled(config.sharingEnabled)
      setTitleEnabled(config.titleEnabled)
      setTitleModelId(config.titleModelId ?? '')
      setTitlePrompt(config.titlePrompt ?? '')
    }
  }, [config])

  const save = useMutation({
    mutationFn: () =>
      updateAppConfig({
        sharingEnabled,
        titleEnabled,
        titleModelId: titleModelId || null,
        titlePrompt: titlePrompt.trim() || null,
      }),
    onSuccess: () => {
      toast.success('已保存')
      qc.invalidateQueries({ queryKey: ['admin', 'app-config'] })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '保存失败'),
  })

  const textModels = (models ?? []).filter((m) => m.kind !== 'image')

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">系统设置</h1>

      {/* 功能设置 */}
      <div className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-1 text-sm font-semibold text-neutral-800 dark:text-neutral-100">分享</h2>
        <div className="flex items-center justify-between py-3">
          <div>
            <div className="text-sm text-neutral-800 dark:text-neutral-100">允许用户分享聊天</div>
            <div className="text-xs text-neutral-400">全局开关；可在账号中心对个别用户单独覆盖。</div>
          </div>
          <Toggle checked={sharingEnabled} onChange={setSharingEnabled} />
        </div>

        <h2 className="mt-4 mb-1 text-sm font-semibold text-neutral-800 dark:text-neutral-100">
          标题总结
        </h2>
        <div className="flex items-center justify-between py-3">
          <div>
            <div className="text-sm text-neutral-800 dark:text-neutral-100">自动总结对话标题</div>
            <div className="text-xs text-neutral-400">首条回复完成后用模型生成简短标题。</div>
          </div>
          <Toggle checked={titleEnabled} onChange={setTitleEnabled} />
        </div>
        {titleEnabled && (
          <div className="space-y-3 py-2">
            <label className="block">
              <span className="mb-1.5 block text-xs text-neutral-500">标题模型</span>
              <Select
                className="w-full"
                value={titleModelId}
                onChange={(e) => setTitleModelId(e.target.value)}
                options={[
                  { value: '', label: '自动（首个可用文本模型）' },
                  ...textModels.map((m) => ({ value: m.id, label: m.displayName })),
                ]}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs text-neutral-500">
                标题提示词（变量：{'{content}'} 对话内容、{'{locale}'} 浏览器语言）
              </span>
              <textarea
                className="min-h-[140px] w-full resize-y rounded-xl border border-neutral-300 bg-white px-3.5 py-2.5 font-mono text-xs text-neutral-800 outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                value={titlePrompt}
                onChange={(e) => setTitlePrompt(e.target.value)}
                placeholder={DEFAULT_TITLE_PROMPT_HINT}
              />
              <span className="mt-1 block text-xs text-neutral-400">留空使用内置默认提示词。</span>
            </label>
          </div>
        )}

        <div className="mt-2 flex justify-end">
          <Button loading={save.isPending} disabled={isLoading} onClick={() => save.mutate()}>
            保存
          </Button>
        </div>
      </div>

      {/* 系统信息 */}
      <div className="rounded-2xl border border-neutral-200 bg-white px-5 dark:border-neutral-800 dark:bg-neutral-900">
        <Row label="名称" value="HappyChat 私有 AI 聊天站" />
        <Row label="版本" value="0.1.0" />
        <Row label="注册方式" value="仅邀请码（首位用户自动成为管理员）" />
        <Row label="数据存储" value="SQLite + 本地文件" />
        <Row label="用户数" value={String(stats?.totals.users ?? '—')} />
        <Row label="会话数" value={String(stats?.totals.conversations ?? '—')} />
      </div>
    </div>
  )
}
