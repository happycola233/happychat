import { useQuery } from '@tanstack/react-query'
import { getStats } from '../../api/admin'
import { Spinner } from '../../components/ui/Spinner'

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
        {value.toLocaleString('zh-CN')}
      </div>
      <div className="mt-1 text-xs text-neutral-500">{label}</div>
    </div>
  )
}

export default function StatsPage() {
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'stats'], queryFn: getStats })

  if (isLoading || !data) {
    return (
      <div className="py-16 text-center">
        <Spinner className="h-6 w-6 text-neutral-400" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">统计</h1>

      <div>
        <h2 className="mb-2 text-sm font-medium text-neutral-500">总览</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="用户" value={data.totals.users} />
          <StatCard label="会话" value={data.totals.conversations} />
          <StatCard label="消息" value={data.totals.messages} />
          <StatCard label="生成任务" value={data.totals.runs} />
          <StatCard label="错误数" value={data.totals.errors} />
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium text-neutral-500">Token 用量</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="输入" value={data.tokens.input} />
          <StatCard label="缓存输入" value={data.tokens.cached} />
          <StatCard label="输出" value={data.tokens.output} />
          <StatCard label="思考" value={data.tokens.reasoning} />
          <StatCard label="图片" value={data.tokens.image} />
          <StatCard label="合计" value={data.tokens.total} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-medium text-neutral-500">模型调用</h2>
          <div className="overflow-hidden rounded-2xl border border-neutral-200 dark:border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs text-neutral-500 dark:bg-neutral-900">
                <tr>
                  <th className="px-3 py-2 font-medium">模型</th>
                  <th className="px-3 py-2 font-medium">调用</th>
                  <th className="px-3 py-2 font-medium">Token</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {data.byModel.map((m) => (
                  <tr key={m.model} className="bg-white dark:bg-neutral-900">
                    <td className="px-3 py-2 text-neutral-800 dark:text-neutral-200">{m.model}</td>
                    <td className="px-3 py-2 text-neutral-500">{m.calls}</td>
                    <td className="px-3 py-2 text-neutral-500">{m.totalTokens.toLocaleString('zh-CN')}</td>
                  </tr>
                ))}
                {!data.byModel.length && (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-neutral-400">
                      暂无数据
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-medium text-neutral-500">用户使用</h2>
          <div className="overflow-hidden rounded-2xl border border-neutral-200 dark:border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs text-neutral-500 dark:bg-neutral-900">
                <tr>
                  <th className="px-3 py-2 font-medium">用户</th>
                  <th className="px-3 py-2 font-medium">调用</th>
                  <th className="px-3 py-2 font-medium">Token</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {data.byUser.map((u) => (
                  <tr key={u.username} className="bg-white dark:bg-neutral-900">
                    <td className="px-3 py-2 text-neutral-800 dark:text-neutral-200">{u.username}</td>
                    <td className="px-3 py-2 text-neutral-500">{u.calls}</td>
                    <td className="px-3 py-2 text-neutral-500">{u.totalTokens.toLocaleString('zh-CN')}</td>
                  </tr>
                ))}
                {!data.byUser.length && (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-neutral-400">
                      暂无数据
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
