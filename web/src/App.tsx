import { useEffect } from 'react'
import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import { ConfirmDialogHost } from './components/ui/ConfirmDialogHost'
import { Toaster } from './components/ui/Toaster'
import { applyTheme } from './lib/theme'
import { useSettings } from './store/settings'
import { useSettingsSync } from './hooks/useSettings'

export default function App() {
  const theme = useSettings((s) => s.theme)
  // 登录后用服务端设置真值覆盖本地缓存。
  useSettingsSync()

  useEffect(() => {
    applyTheme(theme)
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => applyTheme('system')
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  return (
    <>
      <RouterProvider router={router} />
      <Toaster />
      <ConfirmDialogHost />
    </>
  )
}
