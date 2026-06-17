import { useQuery } from '@tanstack/react-query'
import { getStats } from '../../api/admin'

export default function SettingsPage() {
  const { data } = useQuery({ queryKey: ['admin', 'stats'], queryFn: getStats })

  const Row = ({ label, value }: { label: string; value: string }) => (
    <div className="flex items-center justify-between border-b border-neutral-100 py-3 text-sm last:border-0 dark:border-neutral-800">
      <span className="text-neutral-500">{label}</span>
      <span className="font-medium text-neutral-800 dark:text-neutral-200">{value}</span>
    </div>
  )

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-xl font-semibold text-neutral-900 dark:text-neutral-100">系统设置</h1>

      <div className="rounded-2xl border border-neutral-200 bg-white px-5 dark:border-neutral-800 dark:bg-neutral-900">
        <Row label="名称" value="happychat 私有 AI 聊天站" />
        <Row label="版本" value="0.1.0" />
        <Row label="注册方式" value="仅邀请码（首位用户自动成为管理员）" />
        <Row label="数据存储" value="SQLite + 本地文件" />
        <Row label="用户数" value={String(data?.totals.users ?? '—')} />
        <Row label="会话数" value={String(data?.totals.conversations ?? '—')} />
      </div>

      <div className="mt-4 rounded-2xl bg-neutral-50 px-5 py-4 text-sm text-neutral-500 dark:bg-neutral-800/50">
        敏感信息（API Key、会话令牌）均经服务端加密存储，绝不会出现在前端、日志或仓库中。
        Provider、模型、邀请码、用户的管理请在左侧对应页面操作。
      </div>
    </div>
  )
}
