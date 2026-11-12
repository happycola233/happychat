import { Link } from 'react-router-dom'
import { useMaintenanceStatus } from '../hooks/useMaintenance'

export const MAINTENANCE_SETTINGS_PATH = '/admin/settings?section=maintenance'

/**
 * 维护期间给管理员的常驻提醒：管理员自己的页面一切照常，容易忘记结束维护。
 * 只出现在登录后的管理员界面（聊天页与管理后台），普通用户此时看到的是维护页。
 */
export function AdminMaintenanceBar({ className }: { className?: string }) {
  const { data: status } = useMaintenanceStatus()
  if (!status?.notice) return null
  return (
    <div
      role="status"
      className={`flex shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-0.5 bg-amber-50 px-4 py-1.5 text-xs leading-5 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200 ${className ?? ''}`}
    >
      <span>维护模式已开启，其他用户暂时无法使用网站。</span>
      <Link
        to={MAINTENANCE_SETTINGS_PATH}
        className="font-medium underline decoration-amber-400/60 underline-offset-[3px] hover:decoration-amber-600 dark:decoration-amber-300/40 dark:hover:decoration-amber-200"
      >
        前往设置
      </Link>
    </div>
  )
}
