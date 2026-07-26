import { useEffect, useState } from 'react'

/**
 * 响应式读取 window.devicePixelRatio（系统显示缩放 × 浏览器缩放）。
 * 变化来源：跨不同缩放的显示器拖动窗口、调整系统缩放、Ctrl 加减缩放页面。
 * 监听「精确匹配当前 dpr」的 resolution 媒体查询——dpr 一变即失配触发 change，
 * 读到新值后 effect 以新查询重新订阅；浏览器缩放对 dpr 的序列化可能有精度误差
 * 导致查询建立时就不匹配、后续不再收到事件，故再兜底监听 resize（缩放必触发）。
 */
export function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(() =>
    typeof window !== 'undefined' ? window.devicePixelRatio : 1,
  )
  useEffect(() => {
    const onChange = () => setDpr(window.devicePixelRatio)
    const mq = window.matchMedia(`(resolution: ${dpr}dppx)`)
    mq.addEventListener('change', onChange)
    window.addEventListener('resize', onChange)
    return () => {
      mq.removeEventListener('change', onChange)
      window.removeEventListener('resize', onChange)
    }
  }, [dpr])
  return dpr
}
