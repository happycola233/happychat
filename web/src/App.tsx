import { useEffect } from 'react'
import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import { Toaster } from './components/ui/Toaster'
import { applyTheme, useTheme } from './store/theme'

export default function App() {
  const theme = useTheme((s) => s.theme)
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
    </>
  )
}
