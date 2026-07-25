import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { APP_ICON_SRC } from '../../lib/appIcon'
import { AuthThemeToggle } from './AuthThemeToggle'

interface Props {
  /** 页面主标题，如「欢迎回来」。 */
  title: string
  /** 标题下的一句说明。 */
  subtitle: ReactNode
  /** 卡片上方的提示条（首位管理员提示 / 站点未初始化引导）。 */
  notice?: ReactNode
  /** 卡片内的表单。 */
  children: ReactNode
  /** 卡片下方的切换入口（登录 ⇄ 注册）。 */
  footer?: ReactNode
}

/**
 * 登录 / 注册页外壳：氛围光晕 + 品牌区 + 玻璃卡片 + 切换入口，右上角是主题切换。
 *
 * 刻意不做「一半封面图 + 一半表单」的分栏：本项目没有可用的品牌大图，
 * 硬塞图只会显得廉价。取而代之的是单列居中 + 随重点色染色的柔和光晕，
 * 与新对话页输入框后方的 hero 光晕是同一套视觉语言（见 `index.css`）。
 * 样式类前缀 `.hc-auth-*` 也都集中在那里。
 */
export function AuthLayout({ title, subtitle, notice, children, footer }: Props) {
  return (
    <div className="relative flex min-h-full flex-col bg-white dark:bg-black">
      {/* 光晕单独裹一层裁切容器：页面内容超出视口时正常滚动，光晕不会撑出横向滚动条。 */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="hc-auth-glow hc-auth-glow-in" />
      </div>

      <div className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] z-10">
        <AuthThemeToggle />
      </div>

      <main className="relative flex flex-1 items-center justify-center px-5 py-16">
        <div className="w-full max-w-[25.5rem]">
          <header className="hc-auth-in flex flex-col items-center text-center">
            <img
              src={APP_ICON_SRC}
              alt=""
              width={64}
              height={64}
              className="h-16 w-16 rounded-[18px] ring-1 ring-black/5 dark:ring-white/10"
            />
            <h1 className="mt-4 text-[26px] font-semibold leading-tight tracking-tight text-neutral-900 dark:text-neutral-50">
              {title}
            </h1>
            <p className="mt-2 text-[13.5px] leading-6 text-neutral-500 dark:text-neutral-400">
              {subtitle}
            </p>
          </header>

          <div className="hc-auth-in mt-7" style={{ animationDelay: '70ms' }}>
            {notice && <div className="mb-3.5">{notice}</div>}
            <div className="hc-auth-card px-6 py-6 sm:px-7">{children}</div>
          </div>

          {footer && (
            <div
              className="hc-auth-in mt-6 text-center text-[13px] text-neutral-500 dark:text-neutral-400"
              style={{ animationDelay: '140ms' }}
            >
              {footer}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

/** 登录 ⇄ 注册（以及未初始化引导）里的行内链接：低调的细下划线，靠色重与下划线可点。 */
export function AuthLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="font-medium text-neutral-900 underline decoration-neutral-300 decoration-1 underline-offset-[3px] transition hover:decoration-neutral-500 dark:text-neutral-100 dark:decoration-neutral-600 dark:hover:decoration-neutral-400"
    >
      {children}
    </Link>
  )
}
