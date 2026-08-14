import { useEffect, useState } from 'react'

/**
 * 值随渲染频繁变化时延迟取用。
 *
 * 典型用法是把它的结果放进查询键：输入停止若干毫秒后才真正发请求
 * （导出预览、限额生效预览都靠它避免逐字符打网络）。
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}
