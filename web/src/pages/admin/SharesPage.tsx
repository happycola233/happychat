import { LoadError } from '../../components/ui/LoadError'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  adminRevokeShare,
  invalidateShareQueries,
  isShareExpired,
  listAllShares,
} from '../../api/shares'
import { ExternalLinkIcon, ShareIcon } from '../../chat/icons'
import { Badge } from '../../components/ui/Badge'
import { EmptyState } from '../../components/ui/EmptyState'
import { PageHeader } from '../../components/ui/PageHeader'
import { Spinner } from '../../components/ui/Spinner'
import { Button } from '../../components/ui/Button'
import { CopyButton } from '../../components/ui/CopyButton'
import { SearchField } from '../../components/ui/SearchField'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import {
  responsiveTableBody as tableBody,
  responsiveTable as tableEl,
  responsiveTableHead as tableHead,
  responsiveTableRow as tableRowHover,
  mobileCellLabel,
  tableScroll,
  tableShell,
  responsiveTd as td,
  th,
} from '../../components/ui/tableStyles'
import { formatDateTime } from '../../lib/format'
import { toast } from '../../store/toast'

export default function SharesPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const {
    data: shares,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['admin', 'shares'],
    queryFn: listAllShares,
  })
  const revoke = useMutation({
    mutationFn: adminRevokeShare,
    onSuccess: () => {
      toast.success('已撤销分享')
      // 管理员可能撤销自己的分享：一并失效「我的分享」与分享弹窗缓存。
      invalidateShareQueries(qc)
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '操作失败'),
  })
  const keyword = search.trim().toLowerCase()
  const filtered = (shares ?? []).filter((share) => {
    const phase = share.revoked ? 'revoked' : isShareExpired(share) ? 'expired' : 'active'
    return (
      (status === 'all' || phase === status) &&
      `${share.title ?? ''} ${share.ownerUsername ?? ''}`.toLowerCase().includes(keyword)
    )
  })

  return (
    <div className="space-y-5">
      <PageHeader title="分享管理" description="查看全站分享链接并可随时撤销。" />
      <div className="flex flex-wrap items-center gap-3">
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="搜索分享标题或用户"
          className="min-w-48 flex-1"
        />
        <SegmentedControl
          label="分享状态"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: '全部', count: shares?.length ?? 0 },
            { value: 'active', label: '有效' },
            { value: 'expired', label: '已过期' },
            { value: 'revoked', label: '已撤销' },
          ]}
        />
      </div>

      {isError && <LoadError hasData={Boolean(shares)} onRetry={() => void refetch()} />}
      {isError && !shares ? null : isLoading ? (
        <div className="py-16 text-center">
          <Spinner className="h-6 w-6 text-neutral-400" />
        </div>
      ) : !shares?.length ? (
        <EmptyState icon={ShareIcon} title="暂无分享" />
      ) : !filtered.length ? (
        <EmptyState
          title="没有匹配的分享"
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setSearch('')
                setStatus('all')
              }}
            >
              清除筛选
            </Button>
          }
        />
      ) : (
        <div className={tableScroll}>
          <div className={tableShell}>
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
                {filtered.map((s) => (
                  <tr key={s.id} className={tableRowHover}>
                    <td className={`${td} text-neutral-800 dark:text-neutral-100`}>
                      <span className={mobileCellLabel}>拥有者</span>
                      {s.ownerUsername ?? '—'}
                    </td>
                    <td
                      className={`${td} col-span-2 row-start-1 max-w-full truncate text-neutral-700 lg:max-w-[16rem] dark:text-neutral-200`}
                    >
                      {s.title ?? '（无标题）'}
                    </td>
                    <td className={td}>
                      <span className={mobileCellLabel}>显示</span>
                      <div className="flex gap-1">
                        {s.showName && <Badge tone="neutral">名称</Badge>}
                        {s.showAvatar && <Badge tone="neutral">头像</Badge>}
                      </div>
                    </td>
                    <td className={`${td} whitespace-nowrap text-xs text-neutral-500`}>
                      <span className={mobileCellLabel}>创建</span>
                      {formatDateTime(s.createdAt)}
                    </td>
                    <td className={`${td} whitespace-nowrap text-xs text-neutral-500`}>
                      <span className={mobileCellLabel}>过期</span>
                      {s.expiresAt ? formatDateTime(s.expiresAt) : '永久'}
                    </td>
                    <td className={td}>
                      <span className={mobileCellLabel}>状态</span>
                      {s.revoked ? (
                        <Badge tone="danger">已撤销</Badge>
                      ) : isShareExpired(s) ? (
                        <Badge tone="warning">已过期</Badge>
                      ) : (
                        <Badge tone="success">有效</Badge>
                      )}
                    </td>
                    <td className={`${td} col-span-2 text-right whitespace-nowrap`}>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <CopyButton
                          value={`${window.location.origin}/s/${s.token}`}
                          label="复制链接"
                        />
                        <a
                          href={`/s/${s.token}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex min-h-8 items-center gap-1 px-2 text-xs text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                        >
                          <ExternalLinkIcon className="h-3.5 w-3.5" /> 打开
                        </a>
                        {!s.revoked && (
                          <button
                            disabled={revoke.isPending && revoke.variables === s.id}
                            onClick={() => revoke.mutate(s.id)}
                            className="min-h-8 rounded-lg px-2 text-xs text-red-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950/30"
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
