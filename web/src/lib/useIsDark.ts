import { useEffect, useState } from 'react'

/** 订阅 <html> 的 .dark 类，主题切换时驱动重渲染（供 recharts 等内联配色用）。 */
export function useIsDark(): boolean {
  const [dark, setDark] = useState(() =>
    typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : false,
  )
  useEffect(() => {
    const el = document.documentElement
    const update = () => setDark(el.classList.contains('dark'))
    update()
    const observer = new MutationObserver(update)
    observer.observe(el, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return dark
}
