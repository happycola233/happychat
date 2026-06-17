import { useQuery } from '@tanstack/react-query'
import { getErrorLogs } from '../../api/admin'
import { Spinner } from '../../components/ui/Spinner'

const fmt = (ts: number) => new Date(ts).toLocaleString('zh-CN')

export default function LogsPage() {
  const { data: logs, isLoading } = useQuery({
    queryKey: ['admin', 'error-logs'],
    queryFn: getErrorLogs,
    refetchInterval: 10_000,
  })

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-1 text-xl font-semibold text-neutral-900 dark:text-neutral-100">错误日志</h1>
      <p className="mb-6 text-sm text-neutral-500">最近 100 条，每 10 秒自动刷新</p>

      {isLoading ? (
        <div className="py-16 text-center">
          <Spinner className="h-6 w-6 text-neutral-400" />
        </div>
      ) : !logs?.length ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 py-16 text-center text-sm text-neutral-500 dark:border-neutral-700">
          暂无错误日志 🎉
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs text-neutral-500 dark:bg-neutral-900">
              <tr>
                <th className="px-4 py-2 font-medium">时间</th>
                <th className="px-4 py-2 font-medium">来源</th>
                <th className="px-4 py-2 font-medium">类型</th>
                <th className="px-4 py-2 font-medium">信息</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {logs.map((l) => (
                <tr key={l.id} className="bg-white dark:bg-neutral-900">
                  <td className="px-4 py-2 text-xs whitespace-nowrap text-neutral-500">
                    {fmt(l.createdAt)}
                  </td>
                  <td className="px-4 py-2 text-xs text-neutral-500">{l.scope}</td>
                  <td className="px-4 py-2 text-xs text-neutral-500">
                    {l.errorType ?? l.code ?? (l.httpStatus ? `HTTP ${l.httpStatus}` : '—')}
                  </td>
                  <td className="px-4 py-2 text-neutral-700 dark:text-neutral-300">{l.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
