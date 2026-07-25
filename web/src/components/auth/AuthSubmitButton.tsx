import type { ReactNode } from 'react'
import { Spinner } from '../ui/Spinner'

/**
 * 登录 / 注册的主按钮：跟随重点色的实心大按钮（样式见 `index.css` 的 `.hc-auth-submit`）。
 *
 * 不复用 `components/ui/Button`：那颗按钮的 primary 是固定 sky 色、且 loading 会走
 * `disabled:opacity-50` 灰化——提交中的登录按钮灰掉像“不可用”。这里提交中保持重点色，
 * 只把文案换成进行时并禁用重复提交。
 */
export function AuthSubmitButton({
  loading,
  loadingLabel,
  children,
}: {
  loading: boolean
  /** 提交中的文案，如「登录中…」。 */
  loadingLabel: string
  children: ReactNode
}) {
  return (
    <button
      type="submit"
      disabled={loading}
      aria-busy={loading}
      className="hc-auth-submit mt-1 flex h-11 w-full items-center justify-center gap-2 rounded-[0.875rem] text-[15px] font-medium tracking-wide focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-black"
    >
      {loading && <Spinner className="h-4 w-4" />}
      {loading ? loadingLabel : children}
    </button>
  )
}
