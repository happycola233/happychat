import { useEffect, useRef } from 'react'
import { Link, Outlet, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import type { MaintenanceNotice } from '@shared/schemas/maintenance'
import { onMaintenanceRejection } from '../api/client'
import { FullScreenLoader } from '../components/ui/Spinner'
import { useLogout, useMe } from '../hooks/useAuth'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { MAINTENANCE_QUERY_KEY, useMaintenanceStatus } from '../hooks/useMaintenance'
import { MaintenancePage } from './MaintenancePage'
import { MAINTENANCE_COPY, maintenanceLanguages } from './maintenanceCopy'

/**
 * 维护期间把管理员以外的访客（含未登录）挡在维护页；登录页与公开分享页不经过这里。
 * 服务端同时拒绝这些账号的业务请求，这里只负责把页面换掉。
 */
export function MaintenanceGate() {
  const queryClient = useQueryClient()
  const { data: status, isPending } = useMaintenanceStatus()
  const { data: user, isLoading: userLoading } = useMe()
  const notice = status?.notice ?? null
  const blocked = notice !== null && !userLoading && user?.role !== 'admin'

  // 使用中的页面发出的请求一旦被维护拦下，立即重新读取维护状态并切到维护页。
  useEffect(
    () =>
      onMaintenanceRejection(
        () => void queryClient.invalidateQueries({ queryKey: MAINTENANCE_QUERY_KEY }),
      ),
    [queryClient],
  )

  // 维护结束后页面原地恢复：维护期间失败或过期的数据全部重新读取。
  const wasBlocked = useRef(false)
  useEffect(() => {
    if (wasBlocked.current && !blocked) void queryClient.invalidateQueries()
    wasBlocked.current = blocked
  }, [blocked, queryClient])

  // 先确认维护状态再渲染页面：否则未登录的访客会先被带到登录页，看不到维护页。
  if (isPending || (notice && userLoading)) return <FullScreenLoader />
  if (notice && blocked) return <MaintenanceScreen notice={notice} signedIn={Boolean(user)} />
  return <Outlet />
}

function MaintenanceScreen({ notice, signedIn }: { notice: MaintenanceNotice; signedIn: boolean }) {
  const navigate = useNavigate()
  const logout = useLogout()
  const copies = maintenanceLanguages(notice.language).map((language) => MAINTENANCE_COPY[language])
  useDocumentTitle(`${copies[0]!.documentTitle} · HappyChat`)

  const label = (pick: (copy: (typeof copies)[number]) => string) => copies.map(pick).join(' / ')

  return (
    <MaintenancePage
      notice={notice}
      footer={
        signedIn ? (
          // 已登录的普通账号要先退出，才能换管理员账号登录。
          <button
            type="button"
            className="hc-maint-link"
            disabled={logout.isPending}
            onClick={() => logout.mutate(undefined, { onSuccess: () => void navigate('/login') })}
          >
            {label((copy) => copy.switchAccount)}
          </button>
        ) : (
          <Link to="/login" className="hc-maint-link">
            {label((copy) => copy.signIn)}
          </Link>
        )
      }
    />
  )
}
