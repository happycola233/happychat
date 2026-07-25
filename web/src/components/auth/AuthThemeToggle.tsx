import { clsx } from 'clsx'
import type { ComponentType } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import type { ThemePreference } from '@shared/types/domain'
import { useSettings } from '../../store/settings'

const THEME_OPTIONS: readonly {
  value: ThemePreference
  label: string
  icon: ComponentType<{ className?: string }>
}[] = [
  { value: 'system', label: '跟随系统', icon: Monitor },
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
]

/**
 * 登录 / 注册页右上角的主题切换：登录前唯一能改主题的入口
 * （设置弹窗要有账号才能打开，系统是浅色而用户偏好深色时，登录页会一直刺眼）。
 *
 * 直接复用账户级 settings store：未登录时回写服务端会拿到 401，
 * `persistRemote` 已把这种情况视为「仅本地保存」而不报错，登录后由服务端真值覆盖。
 */
export function AuthThemeToggle() {
  const theme = useSettings((s) => s.theme)
  const setTheme = useSettings((s) => s.setTheme)

  return (
    <div
      role="radiogroup"
      aria-label="外观主题"
      className="inline-flex items-center gap-0.5 rounded-full border border-black/[0.07] bg-white/70 p-0.5 shadow-[0_1px_2px_rgb(16_24_40/0.04)] backdrop-blur-md dark:border-white/10 dark:bg-white/[0.05] dark:shadow-none"
    >
      {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = theme === value
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={clsx(
              'flex h-8 w-8 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/60',
              active
                ? 'bg-white text-neutral-900 shadow-[0_1px_2px_rgb(16_24_40/0.1)] dark:bg-white/12 dark:text-neutral-50 dark:shadow-none'
                : 'text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300',
            )}
          >
            <Icon className="h-[15px] w-[15px]" />
          </button>
        )
      })}
    </div>
  )
}
