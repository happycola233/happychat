import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminRevokeShare, listAllShares } from '../../api/shares'
import { ExternalLinkIcon } from '../../chat/icons'
import { Badge } from '../../components/ui/Badge'
import { Spinner } from '../../components/ui/Spinner'
import {
  tableBody,
  tableEl,
  tableHead,
  tableRowHover,
  tableScroll,
  tableShell,
  td,
  th,
} from '../../components/ui/tableStyles'
import { formatDateTime } from '../../lib/format'
import { toast } from '../../store/toast'

export default function SharesPage() {
  const qc = useQueryClient()
  const { data: shares, isLoading } = useQuery({
    queryKey: ['admin', 'shares'],
    queryFn: listAllShares,
  })
  const revoke = useMutation({
    mutationFn: adminRevokeShare,
    onSuccess: () => {
      toast.success('已撤销分享')
      qc.invalidateQueries({ queryKey: ['admin', 'shares'] })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '操作失败'),
  })

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">分享管理</h1>

      {isLoading ? (
        <div className="py-16 text-center">
          <Spinner className="h-6 w-6 text-neutral-400" />
        </div>
      ) : !shares?.length ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 py-16 text-center text-sm text-neutral-500 dark:border-neutral-700">
          暂无分享
        </div>
      ) : (
        <div className={tableScroll}>
          <div className={`${tableShell} min-w-[760px]`}>
            <table className={tableEl}>
              <thead className={tableHead}>
                <tr>
                  <th className={th}>拥有者</th>
                  <th className={th}>标题</th>
                  <th className={th}>显示</th>
                  <th className={th}>创建</th>
                  <th className={th}>过期</th>
                  <th className={th}>状态</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody className={tableBody}>
                {shares.map((s) => (
                  <tr key={s.id} className={tableRowHover}>
                    <td className={`${td} text-neutral-800 dark:text-neutral-100`}>
                      {s.ownerUsername ?? '—'}
                    </td>
                    <td className={`${td} max-w-[16rem] truncate text-neutral-700 dark:text-neutral-200`}>
                      {s.title ?? '（无标题）'}
                    </td>
                    <td className={td}>
                      <div className="flex gap-1">
                        {s.showName && <Badge tone="neutral">名称</Badge>}
                        {s.showAvatar && <Badge tone="neutral">头像</Badge>}
                      </div>
                    </td>
                    <td className={`${td} whitespace-nowrap text-xs text-neutral-500`}>
                      {formatDateTime(s.createdAt)}
                    </td>
                    <td className={`${td} whitespace-nowrap text-xs text-neutral-500`}>
                      {s.expiresAt ? formatDateTime(s.expiresAt) : '永久'}
                    </td>
                    <td className={td}>
                      {s.revoked ? (
                        <Badge tone="danger">已撤销</Badge>
                      ) : (
                        <Badge tone="success">有效</Badge>
                      )}
                    </td>
                    <td className={`${td} text-right whitespace-nowrap`}>
                      <div className="flex items-center justify-end gap-3">
                        <a
                          href={`/s/${s.token}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                        >
                          <ExternalLinkIcon className="h-3.5 w-3.5" /> 打开
                        </a>
                        {!s.revoked && (
                          <button
                            onClick={() => revoke.mutate(s.id)}
                            className="text-xs text-red-500 hover:text-red-600"
                          >
                            撤销
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
